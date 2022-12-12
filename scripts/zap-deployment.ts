import hre from 'hardhat'
const { ethers } = hre

const MAX_TRADE_SLIPPAGE = 50 // 50 bps or 0.5%

async function main() {
  const [deployer] = await ethers.getSigners()

  const ZapRouterFactory = await ethers.getContractFactory('ZapRouter')
  const zapRouter = await ZapRouterFactory.connect(deployer).deploy(MAX_TRADE_SLIPPAGE)
  await zapRouter.deployed()
  console.log(`ZapRouter deployed to ${zapRouter.address}`)

  const ZapperFactory = await ethers.getContractFactory('Zapper')
  const zapper = await ZapperFactory.connect(deployer).deploy(zapRouter.address)
  await zapper.deployed()
  console.log(`Zapper deployed to ${zapper.address}`)

  const CompoundRouterAdapterFactory = await ethers.getContractFactory('CompoundRouterAdapter')
  const compoundRouterAdapter = await CompoundRouterAdapterFactory.deploy()
  await compoundRouterAdapter.deployed()
  await zapRouter.registerAdapter(compoundRouterAdapter.address)
  console.log(`CompoundRouterAdapter deployed to ${compoundRouterAdapter.address}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
