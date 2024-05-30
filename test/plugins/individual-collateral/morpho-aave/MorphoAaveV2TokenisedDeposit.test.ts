import hre from 'hardhat'
import { ITokens, networkConfig } from '#/common/configuration'
import { ethers } from 'hardhat'
import { whileImpersonating } from '../../../utils/impersonation'
import { whales } from '#/tasks/validation/utils/constants'
import { BigNumber, Signer } from 'ethers'
import { formatUnits, parseUnits } from 'ethers/lib/utils'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { bn } from '#/common/numbers'
import { getResetFork } from '../helpers'
import { FORK_BLOCK } from './constants'
import { advanceTime } from '#/utils/time'

type ITokenSymbol = keyof ITokens
const networkConfigToUse = networkConfig[31337]

const mkToken = (symbol: ITokenSymbol) => ({
  address: networkConfigToUse.tokens[symbol]! as string,
  symbol: symbol,
})
const mkTestCase = <T extends ITokenSymbol>(
  symbol: T,
  amount: string,
  inflationStartAmount: string
) => ({
  token: mkToken(symbol),
  poolToken: mkToken(`a${symbol}` as ITokenSymbol),
  amount,
  inflationStartAmount,
})

const TOKENS_TO_TEST = [
  mkTestCase('USDC', '1000.0', '1'),
  mkTestCase('USDT', '1000.0', '1'),
  mkTestCase('DAI', '1000.0', '1'),
  mkTestCase('WETH', '200.0', '1'),
  mkTestCase('stETH', '1.0', '2'),
  mkTestCase('WBTC', '1.0', '1'),
]
type ITestSuiteVariant = typeof TOKENS_TO_TEST[number]

const execTestForToken = ({
  token,
  poolToken,
  amount,
  inflationStartAmount,
}: ITestSuiteVariant) => {
  describe('Tokenised Morpho Position - ' + token.symbol, () => {
    const beforeEachFn = async () => {
      const factories = {
        ERC20Mock: await ethers.getContractFactory('ERC20Mock'),
        MorphoTokenisedDeposit: await ethers.getContractFactory('MorphoAaveV2TokenisedDeposit'),
      }

      const instances = {
        underlying: factories.ERC20Mock.attach(token.address),
        morpho: factories.ERC20Mock.attach(networkConfigToUse.tokens.MORPHO!),
        morphoAaveV2Controller: await ethers.getContractAt(
          'IMorpho',
          networkConfigToUse.MORPHO_AAVE_CONTROLLER!
        ),
        tokenVault: await factories.MorphoTokenisedDeposit.deploy({
          underlyingERC20: token.address,
          poolToken: poolToken.address,
          morphoController: networkConfigToUse.MORPHO_AAVE_CONTROLLER!,
          morphoLens: networkConfigToUse.MORPHO_AAVE_LENS!,
          rewardToken: networkConfigToUse.tokens.MORPHO!,
        }),
      }
      const underlyingDecimals = await instances.underlying.decimals()
      const shareDecimals = await instances.tokenVault.decimals()
      const amountBN = parseUnits(amount, underlyingDecimals)

      const signers = await ethers.getSigners()
      const users = {
        alice: signers[0],
        bob: signers[1],
        charlie: signers[2],
      }

      await whileImpersonating(whales[token.address.toLowerCase()], async (whaleSigner) => {
        await instances.underlying.connect(whaleSigner).transfer(users.alice.address, amountBN)
        await instances.underlying.connect(whaleSigner).transfer(users.bob.address, amountBN)
        await instances.underlying.connect(whaleSigner).transfer(users.charlie.address, amountBN)
      })

      return {
        factories,
        instances,
        amountBN,
        users,
        methods: {
          async mint(user: Signer, amount: BigNumber) {
            await whileImpersonating(whales[token.address.toLowerCase()], async (whaleSigner) => {
              await instances.underlying
                .connect(whaleSigner)
                .transfer(await user.getAddress(), amount)
            })
          },
          deposit: async (user: Signer, amount: string, dest?: string) => {
            await instances.underlying.connect(user).approve(instances.tokenVault.address, 0)
            await instances.underlying
              .connect(user)
              .approve(instances.tokenVault.address, ethers.constants.MaxUint256)
            await instances.tokenVault
              .connect(user)
              .deposit(parseUnits(amount, underlyingDecimals), dest ?? (await user.getAddress()))
          },

          depositBN: async (user: Signer, amount: BigNumber, dest?: string) => {
            await instances.underlying.connect(user).approve(instances.tokenVault.address, 0)
            await instances.underlying
              .connect(user)
              .approve(instances.tokenVault.address, ethers.constants.MaxUint256)

            await instances.tokenVault
              .connect(user)
              .deposit(amount, dest ?? (await user.getAddress()))
          },
          shares: async (user: Signer) => {
            return formatUnits(
              await instances.tokenVault.connect(user).balanceOf(await user.getAddress()),
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
          redeem: async (user: Signer, shares: string, dest?: string) => {
            await instances.tokenVault
              .connect(user)
              .redeem(
                parseUnits(shares, await instances.tokenVault.decimals()),
                dest ?? (await user.getAddress()),
                await user.getAddress()
              )
          },
          balanceUnderlying: async (user: Signer) => {
            return formatUnits(
              await instances.underlying.balanceOf(await user.getAddress()),
              underlyingDecimals
            )
          },
          balanceUnderlyingBn: async (user: Signer) => {
            return await instances.underlying.balanceOf(await user.getAddress())
          },
          balanceMorpho: async (user: Signer) => {
            return formatUnits(await instances.morpho.balanceOf(await user.getAddress()), 18)
          },
          transferShares: async (from: Signer, to: Signer, amount: string) => {
            await instances.tokenVault
              .connect(from)
              .transfer(await to.getAddress(), parseUnits(amount, shareDecimals))
          },
          claimRewards: async (owner: Signer) => {
            await instances.tokenVault.connect(owner).claimRewards()
          },
        },
      }
    }

    type ITestContext = ReturnType<typeof beforeEachFn> extends Promise<infer U> ? U : never
    let context: ITestContext

    before(getResetFork(FORK_BLOCK))

    beforeEach(async () => {
      context = await loadFixture(beforeEachFn)
    })
    const amountAsNumber = parseInt(amount)
    const fraction = (percent: number) => ((amountAsNumber * percent) / 100).toFixed(1)

    const closeTo = async (actual: Promise<string>, expected: string) => {
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

    it('Regression Test - C4 July 2023 Issue #5', async () => {
      const {
        users: { alice, bob },
        methods,
        instances,
        amountBN,
      } = context
      const orignalBalance = await methods.balanceUnderlying(bob)
      await instances.underlying
        .connect(bob)
        .approve(instances.morphoAaveV2Controller.address, ethers.constants.MaxUint256)

      await instances.underlying
        .connect(bob)
        .approve(instances.tokenVault.address, ethers.constants.MaxUint256)

      // Mint a few more tokens so we have enough for the initial 1 wei of a share
      await methods.mint(bob, bn(inflationStartAmount).mul(10))
      await methods.depositBN(bob, bn(inflationStartAmount))

      await instances.morphoAaveV2Controller
        .connect(bob)
        ['supply(address,address,uint256)'](
          await instances.tokenVault.poolToken(),
          instances.tokenVault.address,
          amountBN
        )

      await closeTo(methods.balanceUnderlying(bob), '0.0')
      expect(await methods.shares(alice)).to.equal('0.0')
      await methods.depositBN(alice, amountBN.div(2))

      expect(await methods.shares(alice)).to.not.equal('0.0')
      // expect(await methods.shares(alice)).to.equal('0.0') // <- inflation attack check
      // Bob inflated his 1 wei of a share share to be worth all of Alices deposit
      // ^ The attack above ultimately does not seem to be worth it for the attacker
      // half 25% of the attackers funds end up locked in the zero'th share of the vault

      await methods.withdraw(bob, await methods.assets(bob))
      const postWithdrawalBalance = parseFloat(await methods.balanceUnderlying(bob))

      // Bob should loose funds from the attack
      expect(postWithdrawalBalance).lt(parseFloat(orignalBalance))
    })

    it('linearly distributes rewards', async () => {
      const {
        users: { bob },
        methods,
        instances,
      } = context

      await methods.deposit(bob, '1')

      // Enable transfers on Morpho
      // ugh
      await whileImpersonating(
        '0xcBa28b38103307Ec8dA98377ffF9816C164f9AFa',
        async (whaleSigner) => {
          await whaleSigner.sendTransaction({
            to: '0x9994e35db50125e0df82e4c2dde62496ce330999',
            data: '0x4b5159daa9059cbb000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
          })
          await whaleSigner.sendTransaction({
            to: '0x9994e35db50125e0df82e4c2dde62496ce330999',
            data: '0x4b5159da23b872dd000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
          })
        }
      )

      // Let's drop 700 MORPHO to the tokenVault
      await whileImpersonating(
        '0x6c27114E34173F8E4E7F4060a51EEb1f0120E241',
        async (whaleSigner) => {
          await instances.morpho
            .connect(whaleSigner)
            .transfer(
              instances.tokenVault.address,
              parseUnits('700', await instances.morpho.decimals())
            )
        }
      )

      // Account for rewards
      await instances.tokenVault.sync()

      // Simulate 8 days..
      for (let i = 0; i < 8; i++) {
        await advanceTime(hre, 24 * 60 * 60 - 1)
        await methods.claimRewards(bob)

        if (i < 7) {
          expect(await instances.morpho.balanceOf(await bob.getAddress())).to.be.closeTo(
            BigNumber.from(i + 1)
              .mul(100)
              .mul(BigNumber.from(10).pow(await instances.morpho.decimals())),
            bn('1e18')
          )
        } else {
          expect(await instances.morpho.balanceOf(await bob.getAddress())).to.be.closeTo(
            BigNumber.from(7)
              .mul(100)
              .mul(BigNumber.from(10).pow(await instances.morpho.decimals())),
            bn('1e18')
          )
        }
      }
    })

    it('linearly distributes rewards, even with multiple claims', async () => {
      const {
        users: { bob },
        methods,
        instances,
      } = context

      await methods.deposit(bob, '1')

      // Enable transfers on Morpho
      // ugh
      await whileImpersonating(
        '0xcBa28b38103307Ec8dA98377ffF9816C164f9AFa',
        async (whaleSigner) => {
          await whaleSigner.sendTransaction({
            to: '0x9994e35db50125e0df82e4c2dde62496ce330999',
            data: '0x4b5159daa9059cbb000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
          })
          await whaleSigner.sendTransaction({
            to: '0x9994e35db50125e0df82e4c2dde62496ce330999',
            data: '0x4b5159da23b872dd000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
          })
        }
      )

      // Let's drop 700 MORPHO to the tokenVault
      await whileImpersonating(
        '0x6c27114E34173F8E4E7F4060a51EEb1f0120E241',
        async (whaleSigner) => {
          await instances.morpho
            .connect(whaleSigner)
            .transfer(
              instances.tokenVault.address,
              parseUnits('700', await instances.morpho.decimals())
            )
        }
      )

      // Account for rewards
      await instances.tokenVault.sync()

      // Simulate 3 days..
      for (let i = 0; i < 3; i++) {
        await advanceTime(hre, 24 * 60 * 60 - 1)
        await methods.claimRewards(bob)

        expect(await instances.morpho.balanceOf(await bob.getAddress())).to.be.closeTo(
          BigNumber.from(i + 1)
            .mul(100)
            .mul(BigNumber.from(10).pow(await instances.morpho.decimals())),
          bn('1e18')
        )
      }

      // Let's drop another 300 MORPHO to the tokenVault
      await whileImpersonating(
        '0x6c27114E34173F8E4E7F4060a51EEb1f0120E241',
        async (whaleSigner) => {
          await instances.morpho
            .connect(whaleSigner)
            .transfer(
              instances.tokenVault.address,
              parseUnits('300', await instances.morpho.decimals())
            )
        }
      )

      // Account for rewards
      await instances.tokenVault.sync()

      for (let i = 3; i < 10; i++) {
        await advanceTime(hre, 24 * 60 * 60 - 1)
        await methods.claimRewards(bob)

        expect(await instances.morpho.balanceOf(await bob.getAddress())).to.be.closeTo(
          BigNumber.from(i + 1)
            .mul(100)
            .mul(BigNumber.from(10).pow(await instances.morpho.decimals())),
          bn('1e18')
        )
      }
    })
  })
}

describe('MorphoAaveV2TokenisedDeposit', () => {
  TOKENS_TO_TEST.forEach(execTestForToken)
})
