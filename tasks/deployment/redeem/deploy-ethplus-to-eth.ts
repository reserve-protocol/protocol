import { task } from 'hardhat/config'

task('deploy-redeem-ethplus', 'Deploys the EthPlusIntoEth contract, it offers an easy to use UniswapV2 like interface for external parties to integrate against').setAction(async (_, hre) => {
  const [deployer] = await hre.ethers.getSigners()

  console.log(
    `Deploying EthPlusIntoEth contract to network ${hre.network.name} with deployer account ${deployer.address}...`
  )

  // Deploy the EthPlusIntoEth contract
  const EthPlusIntoEthFactory = await hre.ethers.getContractFactory('EthPlusIntoEth')
  const ethPlusIntoEth = await hre.upgrades.deployProxy(EthPlusIntoEthFactory, [], {
    kind: 'uups',
    redeployImplementation: 'onchange',
  })
  await ethPlusIntoEth.deployed()

  console.log(`Deployed EthPlusIntoEth to ${hre.network.name}:
      EthPlusIntoEth: ${ethPlusIntoEth.address}`)

  /** ******************** Verify EthPlusIntoEth ****************************************/
  console.time('Verifying EthPlusIntoEth Implementation')
  await hre.run('verify:verify', {
    address: ethPlusIntoEth.address,
    constructorArguments: [],
    contract: "contracts/redeem/EthPlusIntoEth.sol:EthPlusIntoEth",
  })
  console.timeEnd('Verifying EthPlusIntoEth Implementation')

  console.log('verified')

})
