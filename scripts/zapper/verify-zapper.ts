import hre from 'hardhat'
import deployment from './zapper.json'
async function main() {
  await hre.run('verify', {
    address: deployment.zapperExecutor,
    constructorArguments: [],
  })
  const wrappedETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  const permit2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
  await hre.run('verify', {
    address: deployment.zapper,
    constructorArguments: [wrappedETH, permit2, deployment.zapperExecutor],
  })
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
