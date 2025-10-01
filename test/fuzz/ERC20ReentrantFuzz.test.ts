import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { fp } from '#/common/numbers'
import {
  ERC20ReentrantFuzz,
  ERC20ReentrantFuzz__factory,
  ChaosOpsScenario,
  ChaosOpsScenario__factory,
  MainP1Fuzz,
  ComponentReentrantMock,
  ComponentReentrantMock__factory,
} from '@typechain/index'
import { exp } from '../plugins/individual-collateral/curve/crv/helpers'

describe('ERC20ReentrantFuzz', () => {
  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  let scenario: ChaosOpsScenario
  let main: MainP1Fuzz
  let token: ERC20ReentrantFuzz
  let mockComponent: ComponentReentrantMock

  beforeEach(async () => {
    ;[owner, alice, bob, carol] = await ethers.getSigners()

    // Deploy the ChaosOpsScenario (includes MainP1Fuzz)
    const scenarioFactory: ChaosOpsScenario__factory = await ethers.getContractFactory(
      'ChaosOpsScenario'
    )
    scenario = await scenarioFactory.deploy()
    main = await ethers.getContractAt('MainP1Fuzz', await scenario.main())

    // Deploy reentrant token
    const tokenFactory: ERC20ReentrantFuzz__factory = await ethers.getContractFactory(
      'ERC20ReentrantFuzz'
    )
    token = await tokenFactory.deploy(
      'Reentrant Token',
      'RT',
      main.address,
      scenario.address
    )

    // Deploy and register mock component for reentrancy testing
    const mockComponentFactory: ComponentReentrantMock__factory = await ethers.getContractFactory(
      'ComponentReentrantMock'
    )
    mockComponent = await mockComponentFactory.deploy()
    await mockComponent.init(main.address)

    // Register the mock component so it can call globalNonReentrant functions
    await main.registerTestComponent(mockComponent.address)
  })

  describe('Basic ERC20 Functionality', () => {
    // These tests ensure it works as a normal ERC20 token

    it('has correct name and symbol', async () => {
      expect(await token.name()).to.equal('Reentrant Token')
      expect(await token.symbol()).to.equal('RT')
    })

    it('allows minting', async () => {
      await token.mint(alice.address, fp('100'))
      expect(await token.balanceOf(alice.address)).to.equal(fp('100'))
    })

    it('allows burning', async () => {
      await token.mint(alice.address, fp('300'))
      await token.burn(alice.address, fp('200'))
      expect(await token.balanceOf(alice.address)).to.equal(fp('100'))
    })

    it('allows normal transfers (do not count as attacks)', async () => {
      // Attacks disabled
      expect(await token.attackEnabled()).to.equal(false)
      expect(await token.attemptedReentrancies()).to.equal(0)

      // Should transfer normally without any reentrancy attempts
      await token.mint(alice.address, fp('200'))
      await token.connect(alice).transfer(bob.address, fp('100'))

      expect(await token.balanceOf(alice.address)).to.equal(fp('100'))
      expect(await token.balanceOf(bob.address)).to.equal(fp('100'))

      // No reentrancy should have been attempted
      expect(await token.attackEnabled()).to.equal(false)
      expect(await token.attemptedReentrancies()).to.equal(0)

      // Enable attacks and transfer again
      await token.enableAttack()
      expect(await token.attackEnabled()).to.equal(true)

      // Should transfer normally without any reentrancy attempts
      await token.connect(alice).transfer(bob.address, fp('100'))

      expect(await token.balanceOf(alice.address)).to.equal(0)
      expect(await token.balanceOf(bob.address)).to.equal(fp('200'))

      // No reentrancy should have been attempted
      expect(await token.attackEnabled()).to.equal(true)
      expect(await token.attemptedReentrancies()).to.equal(0)
    })

    it('allows normal transferFrom (do not count as attacks)', async () => {
      // Attacks disabled
      expect(await token.attackEnabled()).to.equal(false)
      expect(await token.attemptedReentrancies()).to.equal(0)

      // Should transferFrom normally without any reentrancy attempts
      await token.mint(alice.address, fp('200'))
      // Approve and transfer
      await token.connect(alice).approve(bob.address, fp('100'))
      await token.connect(bob).transferFrom(alice.address, carol.address, fp('100'))

      expect(await token.balanceOf(alice.address)).to.equal(fp('100'))
      expect(await token.balanceOf(carol.address)).to.equal(fp('100'))

      // No reentrancy should have been attempted
      expect(await token.attackEnabled()).to.equal(false)
      expect(await token.attemptedReentrancies()).to.equal(0)

      // Enable attacks and transferFrom again
      await token.enableAttack()
      expect(await token.attackEnabled()).to.equal(true)

      // Should transferFrom normally without any reentrancy attempts
      await token.connect(alice).approve(bob.address, fp('100'))
      await token.connect(bob).transferFrom(alice.address, carol.address, fp('100'))

      expect(await token.balanceOf(alice.address)).to.equal(0)
      expect(await token.balanceOf(carol.address)).to.equal(fp('200'))

      // No reentrancy should have been attempted
      expect(await token.attackEnabled()).to.equal(true)
      expect(await token.attemptedReentrancies()).to.equal(0)
    })

    it('allows admin approval', async () => {
      await token.adminApprove(alice.address, bob.address, fp('300'))
      expect(await token.allowance(alice.address, bob.address)).to.equal(fp('300'))
    })
  })

  describe('Attack Configuration', () => {
    it('starts with attacks disabled', async () => {
      expect(await token.attackEnabled()).to.equal(false)
      expect(await scenario.reentrancyTarget()).to.equal(0)
    })

    it('allows enabling attacks', async () => {
      await token.enableAttack()
      expect(await token.attackEnabled()).to.equal(true)
    })

    it('allows disabling attacks', async () => {
      await token.enableAttack()
      expect(await token.attackEnabled()).to.equal(true)
      await token.disableAttack()
      expect(await token.attackEnabled()).to.equal(false)
    })
  })

  describe('Attack Mechanism', () => {
    beforeEach(async () => {
      // Enable attacks and set target for these tests
      await token.enableAttack()
      await scenario.setReentrancyTarget(0) // RTOKEN_ISSUE
    })

    it('attempts reentrancy when transfer happens in reentrant context', async () => {
      await token.mint(mockComponent.address, fp('100'))

      // Use mock component to create globalNonReentrant context
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('10'))

      // Attack should be attempted
      expect(await token.attemptedReentrancies()).to.equal(1)

      // Attack should fail (blocked by guard)
      expect(await token.failedReentrancies()).to.equal(1)
      expect(await token.blockedByGuardReentrancies()).to.equal(1)

      // Transfer should still succeed
      expect(await token.balanceOf(mockComponent.address)).to.equal(fp('90'))
      expect(await token.balanceOf(bob.address)).to.equal(fp('10'))
    })

    it('attempts reentrancy when transferFrom happens in reentrant context', async () => {
      await token.mint(alice.address, fp('100'))

      // Use mock component to create globalNonReentrant context
      await token.connect(alice).approve(mockComponent.address, fp('10'))
      await mockComponent.testReentrantTransferFrom(token.address, alice.address, bob.address, fp('10'))

      // Attack should be attempted
      expect(await token.attemptedReentrancies()).to.equal(1)

      // Attack should fail (blocked by guard)
      expect(await token.failedReentrancies()).to.equal(1)
      expect(await token.blockedByGuardReentrancies()).to.equal(1)

      // Transfer should still succeed
      expect(await token.balanceOf(alice.address)).to.equal(fp('90'))
      expect(await token.balanceOf(bob.address)).to.equal(fp('10'))
    })

    it('attempts reentrancy for zero-amount transfers even in reentrant context', async () => {
      // Zero-amount transfer even in protected context should not trigger attack
      await mockComponent.testReentrantTransfer(token.address, bob.address, 0)
      expect(await token.failedReentrancies()).to.equal(1)
      expect(await token.attemptedReentrancies()).to.equal(1)
      expect(await token.blockedByGuardReentrancies()).to.equal(1)
    })

    it('reports reentrancy attempts/blocks correctly', async () => {
      await token.mint(mockComponent.address, fp('100'))

      // Use mock component to create proper globalNonReentrant context
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('1'))

      // Verify exactly one attack was attempted and blocked by guard
      expect(await token.attemptedReentrancies()).to.equal(1)
      expect(await token.blockedByGuardReentrancies()).to.equal(1)
      expect(await token.failedReentrancies()).to.equal(1)

      // Ensure ALL attempts failed
      expect(await token.attemptedReentrancies()).to.equal(await token.failedReentrancies())
      expect(await token.failedReentrancies()).to.equal(await token.blockedByGuardReentrancies())

      // Should not succeed
      expect(await token.reentrancySucceeded()).to.equal(false)

      // Transfer should have succeeded
      expect(await token.balanceOf(mockComponent.address)).to.equal(fp('99'))
      expect(await token.balanceOf(bob.address)).to.equal(fp('1'))
    })

    it('does not report reentrancy if attacks are disabled', async () => {
      // Disable attack
      await token.disableAttack()

      await token.mint(mockComponent.address, fp('100'))

      // Use mock component to create proper globalNonReentrant context
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('1'))

      // Verify no attack was attempted
      expect(await token.attemptedReentrancies()).to.equal(0)
      expect(await token.blockedByGuardReentrancies()).to.equal(0)
      expect(await token.failedReentrancies()).to.equal(0)

      // Should not succeed
      expect(await token.reentrancySucceeded()).to.equal(false)

      // Transfer should have succeeded
      expect(await token.balanceOf(mockComponent.address)).to.equal(fp('99'))
      expect(await token.balanceOf(bob.address)).to.equal(fp('1'))
    })

    it('does not report reentrancy with non-globalNonReentrant functions', async () => {
      await token.mint(mockComponent.address, fp('100'))

      // Normal transfer (not globalNonReentrant)
      await mockComponent.testNormalTransfer(token.address, bob.address, fp('1'))

      // Verify no attack was attempted
      expect(await token.attemptedReentrancies()).to.equal(0)
      expect(await token.blockedByGuardReentrancies()).to.equal(0)
      expect(await token.failedReentrancies()).to.equal(0)

      // Should not succeed
      expect(await token.reentrancySucceeded()).to.equal(false)

      // Transfer should have succeeded
      expect(await token.balanceOf(mockComponent.address)).to.equal(fp('99'))
      expect(await token.balanceOf(bob.address)).to.equal(fp('1'))
    })

    it('can manage different target functions', async () => {
      // Give mockComponent tokens
      await token.mint(mockComponent.address, fp('100'))

      // Test different targets - all in protected context
      await scenario.setReentrancyTarget(0) // RTOKEN_ISSUE
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('1'))

      await scenario.setReentrancyTarget(4) // STRSR_STAKE
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('1'))

      await scenario.setReentrancyTarget(8) // BACKING_REBALANCE
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('1'))

      // Should have 3 attempts, all failed
      expect(await token.attemptedReentrancies()).to.equal(3)
      expect(await token.failedReentrancies()).to.equal(3)
      expect(await token.blockedByGuardReentrancies()).to.equal(3)
      expect(await token.reentrancySucceeded()).to.equal(false)
    })

    it('continues to work as normal token despite attack attempts', async () => {
      await token.mint(mockComponent.address, fp('100'))

      // Make several transfers with attacks enabled
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('50'))
      await mockComponent.testReentrantTransfer(token.address, carol.address, fp('25'))
      await mockComponent.testReentrantTransfer(token.address, carol.address, fp('25'))

      // Balances should be correct (transfers from mockComponent)
      expect(await token.balanceOf(mockComponent.address)).to.equal(0)
      expect(await token.balanceOf(bob.address)).to.equal(fp('50'))
      expect(await token.balanceOf(carol.address)).to.equal(fp('50'))

      // Verify exactly 3 attacks were attempted and all failed
      expect(await token.attemptedReentrancies()).to.equal(3)
      expect(await token.failedReentrancies()).to.equal(3)
      expect(await token.blockedByGuardReentrancies()).to.equal(3)
      expect(await token.reentrancySucceeded()).to.equal(false)
    })

    it('attack can be toggled on and off', async () => {
      // Give mockComponent tokens
      await token.mint(mockComponent.address, fp('100'))

      // Start enabled, make transfer in protected context (should attack)
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('10'))
      expect(await token.attemptedReentrancies()).to.equal(1)
      expect(await token.failedReentrancies()).to.equal(1)
      expect(await token.blockedByGuardReentrancies()).to.equal(1)

      // Disable attacks, make transfer (should not register attempt)
      await token.disableAttack()
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('10'))
      expect(await token.attemptedReentrancies()).to.equal(1)
      expect(await token.failedReentrancies()).to.equal(1)
      expect(await token.blockedByGuardReentrancies()).to.equal(1)

      // Re-enable attacks, make transfer (should attack again)
      await token.enableAttack()
      await mockComponent.testReentrantTransfer(token.address, bob.address, fp('10'))
      expect(await token.attemptedReentrancies()).to.equal(2)
      expect(await token.failedReentrancies()).to.equal(2)
      expect(await token.blockedByGuardReentrancies()).to.equal(2)
      expect(await token.reentrancySucceeded()).to.equal(false)

    })

    it('properly handles different target functions that might revert for different reasons', async () => {
      await token.mint(mockComponent.address, fp('100'))

      const attemptsBefore = await token.attemptedReentrancies()
      const failedBefore = await token.failedReentrancies()
      const blockedBefore = await token.blockedByGuardReentrancies()

      // Test several different function targets
      const targets = [0, 1, 2, 4, 8, 11] // Various functions

      for (const target of targets) {
        await scenario.setReentrancyTarget(target)
        await mockComponent.testReentrantTransfer(token.address, bob.address, fp('1'))
      }

      // Verify all attempts were made and failed
      expect(await token.attemptedReentrancies()).to.equal(attemptsBefore.add(targets.length))
      expect(await token.failedReentrancies()).to.equal(failedBefore.add(targets.length))
      expect(await token.blockedByGuardReentrancies()).to.equal(blockedBefore.add(targets.length))

      expect(await token.reentrancySucceeded()).to.equal(false)
    })
  })

  describe('Integration with Scenario', () => {
    it('correctly reports to the scenario contract', async () => {
      expect(await token.scenario()).to.equal(scenario.address)
    })
  })
})