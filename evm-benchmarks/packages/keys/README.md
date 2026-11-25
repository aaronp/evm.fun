# @evmb/keys

Keys behind interfaces: `KeyStore`, `KeyScope` (`withSigner`), `KeyGenerator`, and `UnlockProvider`/`Grant`. `BrowserKeyStore` keeps keys in IndexedDB (`KeyPersistence`; in-memory for tests), encrypted with AES-256-GCM under HKDF-SHA256 of the unlock secret; the passphrase provider stretches the passphrase with PBKDF2-SHA256 (600,000 iterations). WebCrypto only; depends on viem only; no UI copy or React. A wrong passphrase throws `Wrong passphrase` and leaves storage untouched. Risk R63, ADR-0026.

Test: `bun test packages/keys`.
