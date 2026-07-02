## upgrade dependencies
rustup update
cargo update

## build for nodejs
wasm-pack build --target nodejs -s stellarbeat

## test
cargo test

node index.js

## publish
wasm-pack publish
