echo "Running Z* exhaustive tests for commit hash: "
git rev-parse HEAD;
NODE_OPTIONS=--max-old-space-size=30000 EXTREME=1 SLOW=1 PROTO_IMPL=1 npx hardhat test test/Z*.test.ts;
