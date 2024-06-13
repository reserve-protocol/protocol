import { task } from 'hardhat/config'

task('deploy-timelock', 'Deploy an instance of a TimelockController')
  .addParam('governor', 'The address to receive propose/execute access control on the timelock')
  .addParam('guardian', 'The guardian to be set on the timelock')
  .setAction(async (params, hre) => {
    const [signer] = await hre.ethers.getSigners()
    const TimelockFactory = await hre.ethers.getContractFactory('TimelockController')
    const timelock = await TimelockFactory.deploy(
      259200, // 3 days
      [params.governor],
      [params.governor],
      signer.address // will renounce after saving guardian
    )
    console.log('Deployed a new TimelockController to: ', timelock.address)

    await timelock.connect(signer).grantRole(await timelock.CANCELLER_ROLE(), params.guardian)
    await timelock
      .connect(signer)
      .renounceRole(await timelock.TIMELOCK_ADMIN_ROLE(), signer.address)

    console.log('Revoked admin role after granting CANCELLER_ROLE to guardian')

    if (!(await timelock.hasRole(await timelock.TIMELOCK_ADMIN_ROLE(), timelock.address))) {
      throw new Error('Timelock does not admin itself')
    }
    if (await timelock.hasRole(await timelock.TIMELOCK_ADMIN_ROLE(), signer.address)) {
      throw new Error('Timelock does not admin itself')
    }
    if (!(await timelock.hasRole(await timelock.PROPOSER_ROLE(), params.governor))) {
      throw new Error('Governor does not have proposer role')
    }
    if (!(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), params.governor))) {
      throw new Error('Governor does not have executor role')
    }

    console.time('Verifying TimelockController')
    await hre.run('verify:verify', {
      address: timelock.address,
      constructorArguments: [259200, [params.governor], [params.governor], signer.address],
      contract: '@openzeppelin/contracts/governance/TimelockController.sol:TimelockController',
    })
    console.timeEnd('Verifying TimelockController')
  })
