//! An **OPFS-backed `KappaStore`** — the paged κ-disk's off-heap backing.
//!
//! The emulator's κ-disk content-addresses every sector in a [`KappaStore`].
//! Backing that store with OPFS instead of the wasm heap is what lets the browser
//! peer boot a *real* image without holding it all in RAM: sectors live in an
//! OPFS pack file, paged in on demand — "the KappaStore IS the memory, RAM is a
//! cache" (the canonical-forms principle).
//!
//! One OPFS file (a single synchronous access handle, opened once in the worker
//! where the emulator runs) holds every blob, appended; a small in-RAM index maps
//! κ → (offset, len) — the offsets, not the data. `get`/`put` are synchronous (the
//! `KappaStore` contract) via the sync access handle. Dedup is intrinsic: an
//! already-held κ is never rewritten (idempotent put, the substrate's cost model).

use std::cell::RefCell;
use std::collections::BTreeMap;

use hologram_substrate_core::{
    address_bytes_axis, Bytes, KappaLabel, KappaLabel71, KappaStore, StoreError,
};
use web_sys::{FileSystemReadWriteOptions, FileSystemSyncAccessHandle};

/// A `Send + Sync` wrapper around an OPFS sync access handle, so a closure that
/// reads from it (the **lazy** κ-disk's rootfs pager) satisfies the `Send + 'static`
/// bound the engine's lazy loader requires. Sound for the same reason as
/// [`OpfsKappaStore`]: the browser peer is single-threaded and the handle is never
/// shared across threads.
pub struct SendSyncHandle(pub FileSystemSyncAccessHandle);
// SAFETY: single-threaded wasm; the handle is never moved/shared across threads.
unsafe impl Send for SendSyncHandle {}
unsafe impl Sync for SendSyncHandle {}

/// A content-addressed store whose blobs live in an OPFS pack file (off the wasm
/// heap), addressed by an in-RAM offset index.
pub struct OpfsKappaStore {
    handle: FileSystemSyncAccessHandle,
    index: RefCell<BTreeMap<[u8; 71], (f64, usize)>>,
    append_at: RefCell<f64>,
}

// The browser peer is single-threaded (wasm has no threads), and the sync access
// handle is never shared across threads — so the `Send + Sync` the `KappaStore`
// trait requires hold trivially here.
unsafe impl Send for OpfsKappaStore {}
unsafe impl Sync for OpfsKappaStore {}

impl OpfsKappaStore {
    /// Wrap a freshly-truncated OPFS sync access handle (opened in the worker).
    #[must_use]
    pub fn new(handle: FileSystemSyncAccessHandle) -> Self {
        OpfsKappaStore {
            handle,
            index: RefCell::new(BTreeMap::new()),
            append_at: RefCell::new(0.0),
        }
    }

    fn axis_arr(axis: &str, bytes: &[u8]) -> Result<[u8; 71], StoreError> {
        let label = address_bytes_axis(axis, bytes).map_err(|_| StoreError::UnknownAxis)?;
        <[u8; 71]>::try_from(label.as_slice()).map_err(|_| StoreError::UnknownAxis)
    }
}

impl KappaStore for OpfsKappaStore {
    fn put(&self, axis: &str, bytes: &[u8]) -> Result<KappaLabel71, StoreError> {
        let arr = Self::axis_arr(axis, bytes)?;
        let kappa = KappaLabel::from_bytes(&arr).map_err(|_| StoreError::InvalidKappa)?;
        // Idempotent: an already-held κ is not rewritten (dedup, Law L3).
        if !self.index.borrow().contains_key(&arr) {
            let at = *self.append_at.borrow();
            let opts = FileSystemReadWriteOptions::new();
            opts.set_at(at);
            let wrote = self
                .handle
                .write_with_u8_array_and_options(bytes, &opts)
                .map_err(|_| StoreError::BackendFailure("opfs write"))?;
            if wrote as usize != bytes.len() {
                return Err(StoreError::BackendFailure("opfs short write"));
            }
            self.index.borrow_mut().insert(arr, (at, bytes.len()));
            *self.append_at.borrow_mut() = at + bytes.len() as f64;
        }
        Ok(kappa)
    }

    fn get(&self, kappa: &KappaLabel71) -> Result<Option<Bytes>, StoreError> {
        let (at, len) = match self.index.borrow().get(kappa.as_array()) {
            Some(&v) => v,
            None => return Ok(None),
        };
        let mut buf = vec![0u8; len];
        let opts = FileSystemReadWriteOptions::new();
        opts.set_at(at);
        let read = self
            .handle
            .read_with_u8_array_and_options(&mut buf, &opts)
            .map_err(|_| StoreError::BackendFailure("opfs read"))?;
        if read as usize != len {
            return Err(StoreError::BackendFailure("opfs short read"));
        }
        Ok(Some(Bytes::from(buf)))
    }

    fn contains(&self, kappa: &KappaLabel71) -> bool {
        self.index.borrow().contains_key(kappa.as_array())
    }

    fn pin(&self, _kappa: &KappaLabel71) -> Result<(), StoreError> {
        Ok(())
    }

    fn unpin(&self, _kappa: &KappaLabel71) -> Result<(), StoreError> {
        Ok(())
    }

    fn iterate(&self) -> Vec<KappaLabel71> {
        self.index
            .borrow()
            .keys()
            .filter_map(|a| KappaLabel::from_bytes(a).ok())
            .collect()
    }

    fn pinned_roots(&self) -> Vec<KappaLabel71> {
        Vec::new()
    }

    fn approximate_count(&self) -> usize {
        self.index.borrow().len()
    }

    fn approximate_bytes(&self) -> u64 {
        *self.append_at.borrow() as u64
    }
}
