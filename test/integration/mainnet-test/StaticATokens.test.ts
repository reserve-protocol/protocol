import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import forkBlockNumber from '../fork-block-numbers'
import mainnetAddrs from '../../../scripts/addresses/mainnet-test/1-tmp-assets-collateral.json'
import {
  ATokenFiatCollateral,
  ERC20Mock,
  FiatCollateral,
  IAToken,
  StaticATokenLM,
  USDCMock,
} from '../../../typechain'
import { useEnv } from '#/utils/env'

// Relevant addresses (Mainnet)
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderADAI = '0x02d60b84491589974263d922d9cc7a3152618ef6'
const holderUSDC = '0x0a59649758aa4d66e25f08dd01271e891fe52199'
const holderAUSDC = '0x611f97d450042418e7338cbdd19202711563df01'
const holderUSDT = '0xf977814e90da44bfa03b6295a0616a897441acec'
const holderAUSDT = '0x611f97d450042418e7338cbdd19202711563df01'
const holderBUSD = '0xf977814e90da44bfa03b6295a0616a897441acec'
const holderABUSD = '0x3ddfa8ec3052539b6c9549f12cea2c295cff5296'

const describeFork = useEnv('FORK') ? describe : describe.skip

const point1Pct = (value: BigNumber): BigNumber => {
  return value.div(1000)
}

describeFork(`Static ATokens - Mainnet Check - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let addr1: SignerWithAddress

  // Tokens and Assets
  let dai: ERC20Mock
  let usdc: USDCMock
  let usdt: ERC20Mock
  let busd: ERC20Mock

  let aDai: IAToken
  let aUsdc: IAToken
  let aUsdt: IAToken
  let aBusd: IAToken
  let stataDai: StaticATokenLM
  let stataUsdc: StaticATokenLM
  let stataUsdt: StaticATokenLM
  let stataBusd: StaticATokenLM

  let daiCollateral: FiatCollateral
  let usdcCollateral: FiatCollateral
  let usdtCollateral: FiatCollateral
  let busdCollateral: FiatCollateral

  let aDaiCollateral: ATokenFiatCollateral
  let aUsdcCollateral: ATokenFiatCollateral
  let aUsdtCollateral: ATokenFiatCollateral
  let aBusdCollateral: ATokenFiatCollateral

  let initialBal: BigNumber

  let chainId: number

  // Setup test environment
  const setup = async (blockNumber: number) => {
    // Use Mainnet fork
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: useEnv('MAINNET_RPC_URL'),
            blockNumber: blockNumber,
          },
        },
      ],
    })
  }

  describe('Static ATokens', () => {
    before(async () => {
      await setup(forkBlockNumber['mainnet-deployment'])

      chainId = await getChainId(hre)
      if (!networkConfig[chainId]) {
        throw new Error(`Missing network configuration for ${hre.network.name}`)
      }
    })

    beforeEach(async () => {
      ;[, , , addr1] = await ethers.getSigners()

      // Get tokens
      dai = <ERC20Mock>(
        await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI || '')
      )

      // Get plain aTokens
      aDai = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aDAI || ''
        )
      )

      //  Get collaterals
      daiCollateral = <FiatCollateral>(
        await ethers.getContractAt('FiatCollateral', mainnetAddrs.collateral.DAI)
      ) // DAI

      aDaiCollateral = <ATokenFiatCollateral>(
        await ethers.getContractAt('FiatCollateral', mainnetAddrs.collateral.aDAI)
      ) // aDAI

      usdcCollateral = <FiatCollateral>(
        await ethers.getContractAt('FiatCollateral', mainnetAddrs.collateral.USDC)
      ) // USDC

      aUsdcCollateral = <ATokenFiatCollateral>(
        await ethers.getContractAt('FiatCollateral', mainnetAddrs.collateral.aUSDC)
      ) // aUSDC

      usdtCollateral = <FiatCollateral>(
        await ethers.getContractAt('FiatCollateral', mainnetAddrs.collateral.USDT)
      ) // USDT

      aUsdtCollateral = <ATokenFiatCollateral>(
        await ethers.getContractAt('FiatCollateral', mainnetAddrs.collateral.aUSDT)
      ) // aUSDT

      busdCollateral = <FiatCollateral>(
        await ethers.getContractAt('FiatCollateral', mainnetAddrs.collateral.BUSD)
      ) // BUSD

      aBusdCollateral = <ATokenFiatCollateral>(
        await ethers.getContractAt('FiatCollateral', mainnetAddrs.collateral.aBUSD)
      ) // aBUSD

      dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await daiCollateral.erc20())
      stataDai = <StaticATokenLM>(
        await ethers.getContractAt('StaticATokenLM', await aDaiCollateral.erc20())
      )
      usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await usdcCollateral.erc20())
      stataUsdc = <StaticATokenLM>(
        await ethers.getContractAt('StaticATokenLM', await aUsdcCollateral.erc20())
      )
      usdt = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await usdtCollateral.erc20())
      stataUsdt = <StaticATokenLM>(
        await ethers.getContractAt('StaticATokenLM', await aUsdtCollateral.erc20())
      )

      busd = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await busdCollateral.erc20())
      stataBusd = <StaticATokenLM>(
        await ethers.getContractAt('StaticATokenLM', await aBusdCollateral.erc20())
      )

      // Get plain aTokens
      aDai = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aDAI || ''
        )
      )
      aUsdc = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aUSDC || ''
        )
      )

      aUsdt = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aUSDT || ''
        )
      )

      aBusd = <IAToken>(
        await ethers.getContractAt(
          '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
          networkConfig[chainId].tokens.aBUSD || ''
        )
      )

      // Set balance amount
      initialBal = bn('20000e18')
    })

    it('Should wrap/unwrap - DAI', async () => {
      await whileImpersonating(holderDAI, async (daiSigner) => {
        await dai.connect(daiSigner).transfer(addr1.address, initialBal)
      })

      // Wrap DAI directly - Underlying = true
      expect(await dai.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await stataDai.balanceOf(addr1.address)).to.equal(0)

      // Wrap DAI into a staticaDAI
      await dai.connect(addr1).approve(stataDai.address, initialBal)
      await stataDai.connect(addr1).deposit(addr1.address, initialBal, 0, true)

      expect(await dai.balanceOf(addr1.address)).to.equal(0)
      expect(await stataDai.balanceOf(addr1.address)).to.be.gt(0)

      const newBalStataDAI = await stataDai.balanceOf(addr1.address)
      await stataDai.connect(addr1).withdraw(addr1.address, newBalStataDAI, true)

      expect(await dai.balanceOf(addr1.address)).to.be.closeTo(initialBal, point1Pct(initialBal))
      expect(await stataDai.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should wrap/unwrap - aDAI', async () => {
      // aDAI
      await whileImpersonating(holderADAI, async (adaiSigner) => {
        await aDai.connect(adaiSigner).transfer(addr1.address, initialBal)
      })

      // Wrap aDAI  - Underlying = false
      expect(await aDai.balanceOf(addr1.address)).to.be.closeTo(initialBal, 1)
      expect(await stataDai.balanceOf(addr1.address)).to.equal(0)

      // Wrap aDAI into a staticaDAI
      await aDai.connect(addr1).approve(stataDai.address, initialBal)
      await stataDai.connect(addr1).deposit(addr1.address, initialBal, 0, false)

      expect(await aDai.balanceOf(addr1.address)).to.be.lt(fp('0.005')) // close to 0
      expect(await stataDai.balanceOf(addr1.address)).to.be.gt(0)

      const newBalStataADAI = await stataDai.balanceOf(addr1.address)
      await stataDai.connect(addr1).withdraw(addr1.address, newBalStataADAI, false)

      expect(await aDai.balanceOf(addr1.address)).to.be.closeTo(initialBal, point1Pct(initialBal))
      expect(await stataDai.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should wrap/unwrap - USDC', async () => {
      const initialBalUSDC = toBNDecimals(initialBal, 6)
      await whileImpersonating(holderUSDC, async (usdcSigner) => {
        await usdc.connect(usdcSigner).transfer(addr1.address, initialBalUSDC)
      })

      // Wrap USDC directly - Underlying = true
      expect(await usdc.balanceOf(addr1.address)).to.equal(initialBalUSDC)
      expect(await stataUsdc.balanceOf(addr1.address)).to.equal(0)

      // Wrap USDC into a staticaUSDC
      await usdc.connect(addr1).approve(stataUsdc.address, initialBalUSDC)
      await stataUsdc.connect(addr1).deposit(addr1.address, initialBalUSDC, 0, true)

      expect(await usdc.balanceOf(addr1.address)).to.equal(0)
      expect(await stataUsdc.balanceOf(addr1.address)).to.be.gt(0)

      const newBalStataUSDC = await stataUsdc.balanceOf(addr1.address)
      await stataUsdc.connect(addr1).withdraw(addr1.address, newBalStataUSDC, true)

      expect(await usdc.balanceOf(addr1.address)).to.be.closeTo(
        initialBalUSDC,
        point1Pct(initialBalUSDC)
      )
      expect(await stataUsdc.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should wrap/unwrap - aUSDC', async () => {
      const initialBalUSDC = toBNDecimals(initialBal, 6)

      // aUSDC
      await whileImpersonating(holderAUSDC, async (ausdcSigner) => {
        await aUsdc.connect(ausdcSigner).transfer(addr1.address, initialBalUSDC)
      })

      // Wrap aUSDC  - Underlying = false
      expect(await aUsdc.balanceOf(addr1.address)).to.be.closeTo(initialBalUSDC, 1)
      expect(await stataUsdc.balanceOf(addr1.address)).to.equal(0)

      // Wrap aUSDC into a staticaUSDC
      await aUsdc.connect(addr1).approve(stataUsdc.address, initialBalUSDC)
      await stataUsdc.connect(addr1).deposit(addr1.address, initialBalUSDC, 0, false)

      expect(await aUsdc.balanceOf(addr1.address)).to.be.lt(50) // close to 0
      expect(await stataUsdc.balanceOf(addr1.address)).to.be.gt(0)

      const newBalStataAUSDC = await stataUsdc.balanceOf(addr1.address)
      await stataUsdc.connect(addr1).withdraw(addr1.address, newBalStataAUSDC, false)

      expect(await aUsdc.balanceOf(addr1.address)).to.be.closeTo(
        initialBalUSDC,
        point1Pct(initialBalUSDC)
      )
      expect(await stataUsdc.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should wrap/unwrap - USDT', async () => {
      const initialBalUSDT = toBNDecimals(initialBal, 6)
      await whileImpersonating(holderUSDT, async (usdtSigner) => {
        await usdt.connect(usdtSigner).transfer(addr1.address, initialBalUSDT)
      })

      // Wrap USDT directly - Underlying = true
      expect(await usdt.balanceOf(addr1.address)).to.equal(initialBalUSDT)
      expect(await stataUsdt.balanceOf(addr1.address)).to.equal(0)

      // Wrap USDCTinto a staticaUSDT
      await usdt.connect(addr1).approve(stataUsdt.address, initialBalUSDT)
      await stataUsdt.connect(addr1).deposit(addr1.address, initialBalUSDT, 0, true)

      expect(await usdt.balanceOf(addr1.address)).to.equal(0)
      expect(await stataUsdt.balanceOf(addr1.address)).to.be.gt(0)

      const newBalStataUSDT = await stataUsdt.balanceOf(addr1.address)
      await stataUsdt.connect(addr1).withdraw(addr1.address, newBalStataUSDT, true)

      expect(await usdt.balanceOf(addr1.address)).to.be.closeTo(
        initialBalUSDT,
        point1Pct(initialBalUSDT)
      )
      expect(await stataUsdt.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should wrap/unwrap - aUSDT', async () => {
      const initialBalUSDT = toBNDecimals(initialBal, 6)

      // aUSDT
      await whileImpersonating(holderAUSDT, async (ausdtSigner) => {
        await aUsdt.connect(ausdtSigner).transfer(addr1.address, initialBalUSDT)
      })

      // Wrap aUSDT  - Underlying = false
      expect(await aUsdt.balanceOf(addr1.address)).to.be.closeTo(initialBalUSDT, 1)
      expect(await stataUsdt.balanceOf(addr1.address)).to.equal(0)

      // Wrap aUSDT into a staticaUSDT
      await aUsdt.connect(addr1).approve(stataUsdt.address, initialBalUSDT)
      await stataUsdt.connect(addr1).deposit(addr1.address, initialBalUSDT, 0, false)

      expect(await aUsdt.balanceOf(addr1.address)).to.be.lt(50) // close to 0
      expect(await stataUsdt.balanceOf(addr1.address)).to.be.gt(0)

      const newBalStataAUSDT = await stataUsdt.balanceOf(addr1.address)
      await stataUsdt.connect(addr1).withdraw(addr1.address, newBalStataAUSDT, false)

      expect(await aUsdt.balanceOf(addr1.address)).to.be.closeTo(
        initialBalUSDT,
        point1Pct(initialBalUSDT)
      )
      expect(await stataUsdt.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should wrap/unwrap - BUSD', async () => {
      await whileImpersonating(holderBUSD, async (busdSigner) => {
        await busd.connect(busdSigner).transfer(addr1.address, initialBal)
      })

      // Wrap BUSD directly - Underlying = true
      expect(await busd.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await stataBusd.balanceOf(addr1.address)).to.equal(0)

      // Wrap BUSD into a staticaBUSD
      await busd.connect(addr1).approve(stataBusd.address, initialBal)
      await stataBusd.connect(addr1).deposit(addr1.address, initialBal, 0, true)

      expect(await busd.balanceOf(addr1.address)).to.equal(0)
      expect(await stataBusd.balanceOf(addr1.address)).to.be.gt(0)

      const newBalStataBUSD = await stataBusd.balanceOf(addr1.address)
      await stataBusd.connect(addr1).withdraw(addr1.address, newBalStataBUSD, true)

      expect(await busd.balanceOf(addr1.address)).to.be.closeTo(initialBal, point1Pct(initialBal))
      expect(await stataBusd.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should wrap/unwrap - aBUSD', async () => {
      // aBUSD
      await whileImpersonating(holderABUSD, async (abusdSigner) => {
        await aBusd.connect(abusdSigner).transfer(addr1.address, initialBal)
      })

      // Wrap aBusd  - Underlying = false
      expect(await aBusd.balanceOf(addr1.address)).to.be.closeTo(initialBal, 1)
      expect(await stataBusd.balanceOf(addr1.address)).to.equal(0)

      // Wrap aBUSD into a staticaBUSD
      await aBusd.connect(addr1).approve(stataBusd.address, initialBal)
      await stataBusd.connect(addr1).deposit(addr1.address, initialBal, 0, false)

      expect(await aBusd.balanceOf(addr1.address)).to.be.lt(fp('0.005')) // close to 0
      expect(await stataBusd.balanceOf(addr1.address)).to.be.gt(0)

      const newBalStataABUSD = await stataBusd.balanceOf(addr1.address)
      await stataBusd.connect(addr1).withdraw(addr1.address, newBalStataABUSD, false)

      expect(await aBusd.balanceOf(addr1.address)).to.be.closeTo(initialBal, point1Pct(initialBal))
      expect(await stataBusd.balanceOf(addr1.address)).to.equal(0)
    })
  })
})
