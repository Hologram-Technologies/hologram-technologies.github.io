// holo-std/prime — primality + prime enumeration (Holo-C). Depends on holo-std/math (uses isqrt).
// The dependency is resolved by content address and the shared math library is linked exactly once.
int isPrime(int n) {
  if (n < 2) return 0;
  int i = 2;
  int r = isqrt(n);                 // from holo-std/math
  while (i <= r) { if (n % i == 0) return 0; i = i + 1; }
  return 1;
}
int nthPrime(int k) {               // 1-indexed: nthPrime(1) = 2, nthPrime(10) = 29
  int count = 0; int n = 1;
  while (count < k) { n = n + 1; if (isPrime(n)) count = count + 1; }
  return n;
}
