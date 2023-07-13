import { ITokens, networkConfig } from '#/common/configuration'
import { ethers } from 'hardhat'
import { whileImpersonating } from '../../../utils/impersonation'
import { whales } from '#/tasks/testing/upgrade-checker-utils/constants'
import { Signer } from 'ethers'
import { formatUnits, parseUnits } from 'ethers/lib/utils'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

type ITokenSymbol = keyof ITokens

const mkToken = (symbol: ITokenSymbol) => ({
  address: networkConfig[1].tokens[symbol]! as string,
  symbol: symbol,
})
const mkTestCase = <T extends ITokenSymbol>(symbol: T, amount: string) => ({
  token: mkToken(symbol),
  poolToken: mkToken(`a${symbol}` as ITokenSymbol),
  amount,
})

const TOKENS_TO_TEST = [
  mkTestCase('USDT', '1000.0'),
  mkTestCase('DAI', '1000.0'),
  mkTestCase('WETH', '1.0'),
  mkTestCase('stETH', '1.0'),
  mkTestCase('WBTC', '1.0'),
  mkTestCase('CRV', '1000.0'),
]
type ITestSuiteVariant = typeof TOKENS_TO_TEST[number]

const execTestForToken = ({ token, poolToken, amount }: ITestSuiteVariant) => {
  describe('Tokenised Morpho Position - ' + token.symbol, () => {
    const beforeEachFn = async () => {
      const factories = {
        ERC20Mock: await ethers.getContractFactory('ERC20Mock'),
        MorphoTokenisedDeposit: await ethers.getContractFactory('MorphoAaveV2TokenisedDeposit'),
      }
      const instances = {
        underlying: factories.ERC20Mock.attach(token.address),
        morpho: factories.ERC20Mock.attach(networkConfig[1].tokens.MORPHO!),
        tokenVault: await factories.MorphoTokenisedDeposit.deploy({
          underlyingERC20: token.address,
          poolToken: poolToken.address,
          morphoController: networkConfig[1].MORPHO_AAVE_CONTROLLER!,
          morphoLens: networkConfig[1].MORPHO_AAVE_LENS!,
          rewardsDistributor: networkConfig[1].MORPHO_REWARDS_DISTRIBUTOR!,
          rewardToken: networkConfig[1].tokens.MORPHO!,
        }),
      }
      const underlyingDecimals = await instances.underlying.decimals()
      const shareDecimals = await instances.tokenVault.decimals()
      const signers = await ethers.getSigners()
      const users = {
        alice: signers[0],
        bob: signers[1],
        charlie: signers[2],
      }

      await whileImpersonating(whales[token.address.toLowerCase()], async (whaleSigner) => {
        await instances.underlying
          .connect(whaleSigner)
          .transfer(users.alice.address, parseUnits(amount, underlyingDecimals))
        await instances.underlying
          .connect(whaleSigner)
          .transfer(users.bob.address, parseUnits(amount, underlyingDecimals))
        await instances.underlying
          .connect(whaleSigner)
          .transfer(users.charlie.address, parseUnits(amount, underlyingDecimals))
      })
      return {
        factories,
        instances,
        users,
        methods: {
          deposit: async (user: Signer, amount: string, dest?: string) => {
            await instances.underlying
              .connect(user)
              .approve(instances.tokenVault.address, parseUnits(amount, underlyingDecimals))
            await instances.tokenVault
              .connect(user)
              .deposit(parseUnits(amount, underlyingDecimals), dest ?? (await user.getAddress()))
          },
          shares: async (user: Signer) => {
            return formatUnits(
              await instances.tokenVault.connect(user).maxRedeem(await user.getAddress()),
              shareDecimals
            )
          },
          assets: async (user: Signer) => {
            return formatUnits(
              await instances.tokenVault.connect(user).maxWithdraw(await user.getAddress()),
              underlyingDecimals
            )
          },
          withdraw: async (user: Signer, amount: string, dest?: string) => {
            await instances.tokenVault
              .connect(user)
              .withdraw(
                parseUnits(amount, underlyingDecimals),
                dest ?? (await user.getAddress()),
                await user.getAddress()
              )
          },
          balanceUnderlying: async (user: Signer) => {
            return formatUnits(
              await instances.underlying.connect(user).balanceOf(await user.getAddress()),
              underlyingDecimals
            )
          },
          balanceMorpho: async (user: Signer) => {
            return formatUnits(
              await instances.morpho.connect(user).balanceOf(await user.getAddress()),
              18
            )
          },
          transferShares: async (from: Signer, to: Signer, amount: string) => {
            await instances.tokenVault
              .connect(from)
              .transfer(await to.getAddress(), parseUnits(amount, shareDecimals))
          },
          unclaimedRewards: async (owner: Signer) => {
            return formatUnits(
              await instances.tokenVault
                .connect(owner)
                .callStatic.rewardTokenBalance(await owner.getAddress()),
              18
            )
          },
          claimRewards: async (owner: Signer) => {
            await instances.tokenVault.connect(owner).claimRewards()
          },
        },
      }
    }

    type ITestContext = ReturnType<typeof beforeEachFn> extends Promise<infer U> ? U : never
    let context: ITestContext

    // const resetFork = getResetFork(17591000)
    beforeEach(async () => {
      context = await loadFixture(beforeEachFn)
    })
    const amountAsNumber = parseInt(amount)
    const fraction = (percent: number) => ((amountAsNumber * percent) / 100).toFixed(1)

    const closeTo = async (actual: Promise<string>, expected: string) => {
      await new Promise((r) => setTimeout(r, 200))
      expect(parseFloat(await actual)).to.closeTo(parseFloat(expected), 0.5)
    }

    it('Deposits', async () => {
      const {
        users: { alice, bob, charlie },
        methods,
      } = context
      expect(await methods.shares(alice)).to.equal('0.0')
      expect(await methods.shares(bob)).to.equal('0.0')
      expect(await methods.shares(charlie)).to.equal('0.0')
      await methods.deposit(alice, fraction(10))
      await closeTo(methods.shares(alice), fraction(10))
      await methods.deposit(bob, fraction(20))
      await closeTo(methods.shares(bob), fraction(20))
      await methods.deposit(charlie, fraction(5))
      await closeTo(methods.shares(charlie), fraction(5))
    })

    it('Deposits and withdraw', async () => {
      const {
        users: { alice, bob },
        methods,
      } = context
      await closeTo(methods.balanceUnderlying(alice), fraction(100))
      expect(await methods.shares(alice)).to.equal('0.0')
      await methods.deposit(alice, fraction(10))
      await methods.deposit(bob, fraction(20))
      await closeTo(methods.balanceUnderlying(alice), fraction(90))

      const aliceShares = await methods.shares(alice)
      await closeTo(Promise.resolve(aliceShares), fraction(10))
      await closeTo(methods.assets(alice), fraction(10))
      await methods.withdraw(alice, (parseFloat(aliceShares) / 2).toString())
      await closeTo(methods.shares(alice), fraction(5))
      await closeTo(methods.assets(alice), fraction(5))
      await closeTo(methods.balanceUnderlying(alice), fraction(95))
      await methods.withdraw(alice, (parseFloat(aliceShares) / 2).toString())
      await closeTo(methods.shares(alice), fraction(0))
      await closeTo(methods.assets(alice), fraction(0))
      await closeTo(methods.balanceUnderlying(alice), fraction(100))
    })

    it('Transfers deposit', async () => {
      const {
        users: { alice, bob },
        methods,
      } = context
      await closeTo(methods.balanceUnderlying(alice), fraction(100))
      expect(await methods.shares(alice)).to.equal('0.0')
      await methods.deposit(alice, fraction(100))

      await closeTo(methods.balanceUnderlying(alice), fraction(0))
      await closeTo(methods.shares(bob), fraction(0))
      await closeTo(methods.balanceUnderlying(bob), fraction(100))
      await closeTo(methods.shares(alice), fraction(100))

      await methods.transferShares(alice, bob, fraction(50))
      await closeTo(methods.shares(alice), fraction(50))
      await closeTo(methods.shares(bob), fraction(50))

      await closeTo(methods.assets(alice), fraction(50))
      await closeTo(methods.assets(bob), fraction(50))
    })

    /**
     * There is a test for claiming rewards in the MorphoAAVEFiatCollateral.test.ts
     */
  })
}
describe('MorphoAaveV2TokenisedDeposit', () => {
  TOKENS_TO_TEST.forEach(execTestForToken)
})
