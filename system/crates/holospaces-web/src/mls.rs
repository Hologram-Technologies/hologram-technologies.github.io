//! **OpenMLS (RFC 9420) spike** — proves Messaging Layer Security runs in the
//! browser peer (wasm32), giving the messenger forward secrecy and
//! post-compromise security its hand-rolled epoch keys lack.
//!
//! This is an isolated proof, not yet wired into [`ChatPeer`](crate::ChatPeer):
//! it forms a real MLS group between two members, has one add the other via a
//! Welcome, and exchanges application messages that decrypt — exercising the
//! TreeKEM key schedule and the per-message secret-tree ratchet (the FS
//! machinery). If this runs in the tab, the full MLS migration is viable.

use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::{MemoryStorage, OpenMlsRustCrypto};
use openmls_traits::OpenMlsProvider;
use wasm_bindgen::prelude::*;

/// Derive a deterministic MLS Ed25519 signature keypair from a seed (HKDF), so a
/// member's MLS identity is stable across devices and reloads — the same seed
/// always yields the same signature key (and thus the same credential).
fn signer_from_seed(seed: &[u8]) -> SignatureKeyPair {
    let sk = ed25519_dalek::SigningKey::from_bytes(&crate::hkdf32(seed, b"holospaces/chat/mls-ed25519"));
    let public = sk.verifying_key().to_bytes().to_vec();
    let private = sk.to_bytes().to_vec();
    SignatureKeyPair::from_raw(SignatureScheme::ED25519, private, public)
}

/// Snapshot the MLS key store (the public `values` map) to bytes — the durable
/// group state (ratchet tree, epoch secrets, leaf keys) a peer persists.
fn serialize_store(store: &MemoryStorage) -> Vec<u8> {
    let values = store.values.read().unwrap();
    let mut out = (values.len() as u32).to_le_bytes().to_vec();
    for (k, v) in values.iter() {
        out.extend_from_slice(&(k.len() as u32).to_le_bytes());
        out.extend_from_slice(k);
        out.extend_from_slice(&(v.len() as u32).to_le_bytes());
        out.extend_from_slice(v);
    }
    out
}

/// Replace a key store's contents from [`serialize_store`] bytes.
fn load_store(store: &MemoryStorage, bytes: &[u8], cur: &mut usize) -> Result<(), JsValue> {
    let take = |cur: &mut usize, n: usize| -> Result<&[u8], JsValue> {
        let end = cur.checked_add(n).filter(|e| *e <= bytes.len()).ok_or_else(|| JsValue::from_str("truncated state"))?;
        let s = &bytes[*cur..end];
        *cur = end;
        Ok(s)
    };
    let read_u32 = |cur: &mut usize| -> Result<usize, JsValue> {
        let b = take(cur, 4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };
    let count = read_u32(cur)?;
    let mut map = std::collections::HashMap::with_capacity(count);
    for _ in 0..count {
        let kl = read_u32(cur)?;
        let k = take(cur, kl)?.to_vec();
        let vl = read_u32(cur)?;
        let v = take(cur, vl)?.to_vec();
        map.insert(k, v);
    }
    *store.values.write().unwrap() = map;
    Ok(())
}

/// The ciphersuite: DHKEM(X25519)+ChaCha20-Poly1305+SHA256+Ed25519 — the same
/// primitives the rest of the messenger uses, in MLS's TreeKEM.
const CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519;

fn member(
    provider: &OpenMlsRustCrypto,
    name: &[u8],
) -> Result<(SignatureKeyPair, CredentialWithKey), JsValue> {
    let signature_keys = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm())
        .map_err(|e| JsValue::from_str(&format!("sig keygen: {e:?}")))?;
    signature_keys
        .store(provider.storage())
        .map_err(|e| JsValue::from_str(&format!("store sig: {e:?}")))?;
    let credential = BasicCredential::new(name.to_vec());
    let credential_with_key = CredentialWithKey {
        credential: credential.into(),
        signature_key: signature_keys.public().into(),
    };
    Ok((signature_keys, credential_with_key))
}

// ── MlsChannel: the MLS group lifecycle as a peer API (the migration) ───────
//
// Each method's bytes are content that flows over the κ pub/sub relay exactly
// like a Message or KeyEnvelope: `key_package` (so an admin can add you),
// `add_member` → a Welcome (to the new member) + a Commit (to existing members),
// `send` → an application message, `remove_member` → a Commit. Forward secrecy
// and post-compromise security come from MLS's TreeKEM ratchet on every Commit.

/// The Welcome + Commit a membership change produces, to publish over the relay.
#[wasm_bindgen]
pub struct MlsChange {
    welcome: Vec<u8>,
    commit: Vec<u8>,
}

#[wasm_bindgen]
impl MlsChange {
    /// The Welcome message (empty for a removal) — delivered to the new member.
    #[wasm_bindgen(getter)]
    pub fn welcome(&self) -> Vec<u8> {
        self.welcome.clone()
    }
    /// The Commit message — delivered to every existing member to advance the epoch.
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.commit.clone()
    }
}

/// One member's view of one MLS channel: its identity (signature key + basic
/// credential), its crypto provider (key store), and — once created or joined —
/// its [`MlsGroup`].
#[wasm_bindgen]
pub struct MlsChannel {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    group: Option<MlsGroup>,
}

#[wasm_bindgen]
impl MlsChannel {
    /// A member identity named `identity`, keyed deterministically from `seed`
    /// (the same seed reproduces the same MLS identity on every device). No group
    /// yet — call [`create_group`](MlsChannel::create_group) or
    /// [`join`](MlsChannel::join). Persist/restore the group with
    /// [`export_state`](MlsChannel::export_state) / [`restore`](MlsChannel::restore).
    #[wasm_bindgen(constructor)]
    pub fn new(seed: &[u8], identity: &[u8]) -> Result<MlsChannel, JsValue> {
        let provider = OpenMlsRustCrypto::default();
        let signer = signer_from_seed(seed);
        signer
            .store(provider.storage())
            .map_err(|err| JsValue::from_str(&format!("store sig: {err:?}")))?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.to_vec()).into(),
            signature_key: signer.public().into(),
        };
        Ok(MlsChannel {
            provider,
            signer,
            credential,
            group: None,
        })
    }

    /// Snapshot this channel's durable state (the MLS key store + group id +
    /// identity) to bytes — what a peer persists to OPFS / the κ-store so the
    /// group survives a reload. The bytes hold secret key material, so store them
    /// encrypted at rest. Pair with [`restore`](MlsChannel::restore).
    pub fn export_state(&self) -> Result<Vec<u8>, JsValue> {
        let group = self.group.as_ref().ok_or_else(|| JsValue::from_str("no group"))?;
        let gid = group.group_id().as_slice();
        let id = self.credential_identity();
        let mut out = (gid.len() as u32).to_le_bytes().to_vec();
        out.extend_from_slice(gid);
        out.extend_from_slice(&(id.len() as u32).to_le_bytes());
        out.extend_from_slice(&id);
        out.extend_from_slice(&serialize_store(self.provider.storage()));
        Ok(out)
    }

    /// Restore a channel from a `seed` and the bytes from
    /// [`export_state`](MlsChannel::export_state): rebuilds the key store, the
    /// deterministic signer, and loads the MLS group — picking the conversation
    /// back up at its current epoch (forward secrecy preserved).
    pub fn restore(seed: &[u8], state: &[u8]) -> Result<MlsChannel, JsValue> {
        let mut cur = 0usize;
        let read_u32 = |cur: &mut usize| -> Result<usize, JsValue> {
            let end = cur.checked_add(4).filter(|e| *e <= state.len()).ok_or_else(|| JsValue::from_str("truncated state"))?;
            let b = &state[*cur..end];
            *cur = end;
            Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
        };
        let gid_len = read_u32(&mut cur)?;
        let gid = state.get(cur..cur + gid_len).ok_or_else(|| JsValue::from_str("truncated gid"))?.to_vec();
        cur += gid_len;
        let id_len = read_u32(&mut cur)?;
        let identity = state.get(cur..cur + id_len).ok_or_else(|| JsValue::from_str("truncated id"))?.to_vec();
        cur += id_len;

        let provider = OpenMlsRustCrypto::default();
        load_store(provider.storage(), state, &mut cur)?;
        let signer = signer_from_seed(seed);
        // Ensure the signer is present even if the snapshot predated it.
        signer
            .store(provider.storage())
            .map_err(|err| JsValue::from_str(&format!("store sig: {err:?}")))?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity).into(),
            signature_key: signer.public().into(),
        };
        let group = MlsGroup::load(provider.storage(), &GroupId::from_slice(&gid))
            .map_err(|err| JsValue::from_str(&format!("group load: {err:?}")))?
            .ok_or_else(|| JsValue::from_str("group not found in state"))?;
        Ok(MlsChannel {
            provider,
            signer,
            credential,
            group: Some(group),
        })
    }

    fn credential_identity(&self) -> Vec<u8> {
        self.credential.credential.serialized_content().to_vec()
    }

    /// Found a new group (this peer becomes its admin / first member).
    pub fn create_group(&mut self) -> Result<(), JsValue> {
        let cfg = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .build();
        let group = MlsGroup::new(&self.provider, &self.signer, &cfg, self.credential.clone())
            .map_err(|err| JsValue::from_str(&format!("group new: {err:?}")))?;
        self.group = Some(group);
        Ok(())
    }

    /// This member's **KeyPackage** bytes — published so an admin can add them.
    pub fn key_package(&self) -> Result<Vec<u8>, JsValue> {
        let bundle = KeyPackage::builder()
            .build(CIPHERSUITE, &self.provider, &self.signer, self.credential.clone())
            .map_err(|err| JsValue::from_str(&format!("keypackage: {err:?}")))?;
        bundle
            .key_package()
            .tls_serialize_detached()
            .map_err(|err| JsValue::from_str(&format!("kp serialize: {err:?}")))
    }

    /// **Add a member** by their KeyPackage bytes (admin). Returns the Welcome
    /// (for the new member) and the Commit (for existing members). The Commit is
    /// merged locally, advancing the epoch.
    pub fn add_member(&mut self, key_package_bytes: &[u8]) -> Result<MlsChange, JsValue> {
        let kp_in = KeyPackageIn::tls_deserialize_exact(key_package_bytes)
            .map_err(|err| JsValue::from_str(&format!("kp deserialize: {err:?}")))?;
        let key_package = kp_in
            .validate(self.provider.crypto(), ProtocolVersion::Mls10)
            .map_err(|err| JsValue::from_str(&format!("kp validate: {err:?}")))?;
        let group = self.group.as_mut().ok_or_else(|| JsValue::from_str("no group"))?;
        let (commit, welcome, _gi) = group
            .add_members(&self.provider, &self.signer, &[key_package])
            .map_err(|err| JsValue::from_str(&format!("add_members: {err:?}")))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|err| JsValue::from_str(&format!("merge: {err:?}")))?;
        Ok(MlsChange {
            welcome: welcome
                .tls_serialize_detached()
                .map_err(|err| JsValue::from_str(&format!("welcome serialize: {err:?}")))?,
            commit: commit
                .tls_serialize_detached()
                .map_err(|err| JsValue::from_str(&format!("commit serialize: {err:?}")))?,
        })
    }

    /// **Join** a group from a Welcome message (the bytes the admin published).
    pub fn join(&mut self, welcome_bytes: &[u8]) -> Result<(), JsValue> {
        let msg_in = MlsMessageIn::tls_deserialize_exact(welcome_bytes)
            .map_err(|err| JsValue::from_str(&format!("welcome deserialize: {err:?}")))?;
        let welcome = match msg_in.extract() {
            MlsMessageBodyIn::Welcome(w) => w,
            _ => return Err(JsValue::from_str("expected a Welcome")),
        };
        let cfg = MlsGroupJoinConfig::default();
        let staged = StagedWelcome::new_from_welcome(&self.provider, &cfg, welcome, None)
            .map_err(|err| JsValue::from_str(&format!("staged welcome: {err:?}")))?;
        let group = staged
            .into_group(&self.provider)
            .map_err(|err| JsValue::from_str(&format!("into_group: {err:?}")))?;
        self.group = Some(group);
        Ok(())
    }

    /// **Remove a member** by their identity bytes (admin). Returns the Commit to
    /// publish; existing members [`receive`](MlsChannel::receive) it and the
    /// removed member can no longer decrypt subsequent messages (PCS).
    pub fn remove_member(&mut self, identity: &[u8]) -> Result<MlsChange, JsValue> {
        let group = self.group.as_mut().ok_or_else(|| JsValue::from_str("no group"))?;
        let leaf = group
            .members()
            .find(|m| m.credential.serialized_content() == identity)
            .map(|m| m.index)
            .ok_or_else(|| JsValue::from_str("no such member"))?;
        let (commit, _welcome, _gi) = group
            .remove_members(&self.provider, &self.signer, &[leaf])
            .map_err(|err| JsValue::from_str(&format!("remove_members: {err:?}")))?;
        group
            .merge_pending_commit(&self.provider)
            .map_err(|err| JsValue::from_str(&format!("merge remove: {err:?}")))?;
        Ok(MlsChange {
            welcome: Vec::new(),
            commit: commit
                .tls_serialize_detached()
                .map_err(|err| JsValue::from_str(&format!("commit serialize: {err:?}")))?,
        })
    }

    /// Encrypt and frame `plaintext` as an MLS application message (forward
    /// secret) — the bytes to publish as the message body.
    pub fn send(&mut self, plaintext: &str) -> Result<Vec<u8>, JsValue> {
        let group = self.group.as_mut().ok_or_else(|| JsValue::from_str("no group"))?;
        let out = group
            .create_message(&self.provider, &self.signer, plaintext.as_bytes())
            .map_err(|err| JsValue::from_str(&format!("create_message: {err:?}")))?;
        out.tls_serialize_detached()
            .map_err(|err| JsValue::from_str(&format!("msg serialize: {err:?}")))
    }

    /// Process an inbound MLS message (an application message or a Commit). For an
    /// application message, returns JSON `{ "kind": "app", "text": "…" }`; for a
    /// Commit (membership change), merges it and returns `{ "kind": "commit",
    /// "epoch": n, "active": bool }` (`active:false` means this peer was removed).
    pub fn receive(&mut self, message_bytes: &[u8]) -> Result<String, JsValue> {
        let msg_in = MlsMessageIn::tls_deserialize_exact(message_bytes)
            .map_err(|err| JsValue::from_str(&format!("msg deserialize: {err:?}")))?;
        let protocol = msg_in
            .try_into_protocol_message()
            .map_err(|err| JsValue::from_str(&format!("protocol: {err:?}")))?;
        let group = self.group.as_mut().ok_or_else(|| JsValue::from_str("no group"))?;
        let processed = group
            .process_message(&self.provider, protocol)
            .map_err(|err| JsValue::from_str(&format!("process: {err:?}")))?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(app) => {
                let text = String::from_utf8(app.into_bytes())
                    .map_err(|err| JsValue::from_str(&format!("utf8: {err:?}")))?;
                Ok(serde_json::json!({ "kind": "app", "text": text }).to_string())
            }
            ProcessedMessageContent::StagedCommitMessage(staged) => {
                group
                    .merge_staged_commit(&self.provider, *staged)
                    .map_err(|err| JsValue::from_str(&format!("merge staged: {err:?}")))?;
                let active = group.is_active();
                Ok(serde_json::json!({
                    "kind": "commit",
                    "epoch": group.epoch().as_u64(),
                    "active": active,
                })
                .to_string())
            }
            _ => Ok(serde_json::json!({ "kind": "other" }).to_string()),
        }
    }

    /// The current member count.
    pub fn members(&self) -> Result<u32, JsValue> {
        let group = self.group.as_ref().ok_or_else(|| JsValue::from_str("no group"))?;
        Ok(group.members().count() as u32)
    }

    /// The current epoch (advances on every Commit).
    pub fn epoch(&self) -> Result<f64, JsValue> {
        let group = self.group.as_ref().ok_or_else(|| JsValue::from_str("no group"))?;
        Ok(group.epoch().as_u64() as f64)
    }
}

/// Run a full two-member MLS exchange in-tab and report the result as JSON:
/// `{ ciphersuite, members, msg1, msg2, epoch }`. The two messages decrypting in
/// order is the forward-secret ratchet working; `members == 2` and a non-zero
/// epoch are the TreeKEM group state.
#[wasm_bindgen]
pub fn mls_selftest() -> Result<String, JsValue> {
    // Two members, each with its own provider (independent key stores).
    let alice_p = OpenMlsRustCrypto::default();
    let bob_p = OpenMlsRustCrypto::default();
    let (alice_sig, alice_cwk) = member(&alice_p, b"alice")?;
    let (bob_sig, bob_cwk) = member(&bob_p, b"bob")?;

    // Bob publishes a KeyPackage (the content another member adds him with).
    let bob_kp = KeyPackage::builder()
        .build(CIPHERSUITE, &bob_p, &bob_sig, bob_cwk)
        .map_err(|e| JsValue::from_str(&format!("keypackage: {e:?}")))?;

    // Alice creates the group and adds Bob.
    let cfg = MlsGroupCreateConfig::builder()
        .ciphersuite(CIPHERSUITE)
        // Carry the ratchet tree in the GroupInfo/Welcome so a joiner can build
        // the group without fetching it separately (fine for small team channels).
        .use_ratchet_tree_extension(true)
        .build();
    let mut alice_group = MlsGroup::new(&alice_p, &alice_sig, &cfg, alice_cwk)
        .map_err(|e| JsValue::from_str(&format!("group new: {e:?}")))?;

    let (_commit, welcome, _group_info) = alice_group
        .add_members(&alice_p, &alice_sig, &[bob_kp.key_package().clone()])
        .map_err(|e| JsValue::from_str(&format!("add_members: {e:?}")))?;
    alice_group
        .merge_pending_commit(&alice_p)
        .map_err(|e| JsValue::from_str(&format!("merge: {e:?}")))?;

    // Bob joins from the Welcome — it travels as bytes, so parse it as an
    // inbound MLS message and extract the Welcome body.
    let welcome_bytes = welcome
        .tls_serialize_detached()
        .map_err(|e| JsValue::from_str(&format!("welcome serialize: {e:?}")))?;
    let welcome_in = MlsMessageIn::tls_deserialize_exact(&welcome_bytes)
        .map_err(|e| JsValue::from_str(&format!("welcome deserialize: {e:?}")))?;
    let welcome = match welcome_in.extract() {
        MlsMessageBodyIn::Welcome(w) => w,
        _ => return Err(JsValue::from_str("expected a Welcome message")),
    };
    let join_cfg = MlsGroupJoinConfig::default();
    let staged = StagedWelcome::new_from_welcome(&bob_p, &join_cfg, welcome, None)
        .map_err(|e| JsValue::from_str(&format!("staged welcome: {e:?}")))?;
    let mut bob_group = staged
        .into_group(&bob_p)
        .map_err(|e| JsValue::from_str(&format!("into_group: {e:?}")))?;

    // Alice → Bob: two application messages (each ratchets the secret tree).
    let deliver = |group_out: MlsMessageOut, to: &mut MlsGroup, p: &OpenMlsRustCrypto| -> Result<String, JsValue> {
        let bytes = group_out
            .tls_serialize_detached()
            .map_err(|e| JsValue::from_str(&format!("serialize: {e:?}")))?;
        let msg_in = MlsMessageIn::tls_deserialize_exact(&bytes)
            .map_err(|e| JsValue::from_str(&format!("deserialize: {e:?}")))?;
        let protocol = msg_in
            .try_into_protocol_message()
            .map_err(|e| JsValue::from_str(&format!("protocol: {e:?}")))?;
        let processed = to
            .process_message(p, protocol)
            .map_err(|e| JsValue::from_str(&format!("process: {e:?}")))?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(app) => {
                String::from_utf8(app.into_bytes()).map_err(|e| JsValue::from_str(&format!("utf8: {e:?}")))
            }
            _ => Err(JsValue::from_str("not an application message")),
        }
    };

    let out1 = alice_group
        .create_message(&alice_p, &alice_sig, b"forward-secret hello")
        .map_err(|e| JsValue::from_str(&format!("create1: {e:?}")))?;
    let msg1 = deliver(out1, &mut bob_group, &bob_p)?;

    let out2 = alice_group
        .create_message(&alice_p, &alice_sig, b"ratcheted again")
        .map_err(|e| JsValue::from_str(&format!("create2: {e:?}")))?;
    let msg2 = deliver(out2, &mut bob_group, &bob_p)?;

    let members = alice_group.members().count();
    let epoch = alice_group.epoch().as_u64();

    Ok(serde_json::json!({
        "ciphersuite": "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519",
        "members": members,
        "msg1": msg1,
        "msg2": msg2,
        "epoch": epoch,
    })
    .to_string())
}
