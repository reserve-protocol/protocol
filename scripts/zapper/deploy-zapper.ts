import hre from 'hardhat'
import fs from 'fs'

async function main() {
  const ZapperExecutorFactory = await hre.ethers.getContractFactory('ZapperExecutor')
  const zapperExecutor = await ZapperExecutorFactory.deploy()
  await zapperExecutor.deployed()
  console.log('ZapperExecutor deployed to:', zapperExecutor.address)

  const ZapperFactory = await hre.ethers.getContractFactory('Zapper')
  const wrappedETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  const permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
  const zapper = await ZapperFactory.deploy(wrappedETH, permit2, zapperExecutor.address)
  await zapper.deployed()
  console.log('Zapper deployed to:', zapper.address)

  fs.writeFileSync('./zapper.json', {
    zapper: zapper.address,
    zapperExecutor: zapperExecutor.address,
  })
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
