// holo-std/combo — combinatorics (Holo-C). Depends on holo-std/math (uses min). Linking combo and
// prime together pulls holo-std/math once (Law L3 dedup) — a real transitive dependency graph.
int factorial(int n) { int r = 1; while (n > 1) { r = r * n; n = n - 1; } return r; }
int choose(int n, int k) {          // n-choose-k, computed without overflow-prone full factorials
  k = min(k, n - k);                // from holo-std/math
  int num = 1; int den = 1; int i = 0;
  while (i < k) { num = num * (n - i); den = den * (i + 1); i = i + 1; }
  return num / den;
}
