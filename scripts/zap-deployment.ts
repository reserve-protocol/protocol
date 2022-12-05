import hre from 'hardhat'
const { ethers } = hre

const MAX_TRADE_SLIPPAGE = 50 // 50 bps or 0.5%
const SUPPORTED_TOKENS = [
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
]

async function main() {
  const [deployer] = await ethers.getSigners()

  const ZapRouterFactory = await ethers.getContractFactory('ZapRouter')
  const zapRouter = await ZapRouterFactory.connect(deployer).deploy(
    SUPPORTED_TOKENS,
    MAX_TRADE_SLIPPAGE
  )
  await zapRouter.deployed()
  console.log(`ZapRouter deployed to ${zapRouter.address}`)

  const ZapperFactory = await ethers.getContractFactory('Zapper')
  const zapper = await ZapperFactory.connect(deployer).deploy(zapRouter.address)
  await zapper.deployed()
  console.log(`Zapper deployed to ${zapper.address}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
