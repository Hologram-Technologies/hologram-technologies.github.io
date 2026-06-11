// holo-std/math — integer math primitives (Holo-C). A content-addressed library: its κ is the
// hash of these exact bytes; anything that links it pins it by content (Law L1), re-derives it
// (Law L5), and shares it once across the whole dependency graph (Law L3).
int abs(int x) { if (x < 0) return -x; return x; }
int min(int a, int b) { if (a < b) return a; return b; }
int max(int a, int b) { if (a > b) return a; return b; }
int gcd(int a, int b) { while (b != 0) { int t = a % b; a = b; b = t; } return a; }
int isqrt(int n) { int r = 0; while ((r + 1) * (r + 1) <= n) { r = r + 1; } return r; }
int ipow(int base, int exp) { int r = 1; while (exp > 0) { r = r * base; exp = exp - 1; } return r; }
