const forkBlockNumber = {
  'aave-compound-rewards': 12521999, // Ethereum
  default: process.env.MAINNET_BLOCK ? Number(process.env.MAINNET_BLOCK) : 14916729, // Ethereum
}

export default forkBlockNumber
