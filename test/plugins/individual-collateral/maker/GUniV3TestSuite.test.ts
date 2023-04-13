import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintGUNIDAIUSCD } from './helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber, BigNumberish, Contract } from 'ethers'
import {
  ERC20Mock,
  ERC20PresetMinterPauser,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  GUniV3Collateral
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  DAI_USD_PRICE_FEED,
  USDC_USD_PRICE_FEED,
  DAI,
  USDC,
  MCD_VAT,
  MCD_JOIN_GUNIV3DAIUSDC1_A,
  MCD_JOIN_GUNIV3DAIUSDC2_A,
  GUNIV3DAIUSDC1,
  GUNIV3DAIUSDC1_POOL_ILK,
  GUNIV3DAIUSDC2,
  GUNIV3DAIUSDC2_POOL_ILK,
  DAI_WHALE,
  USDC_WHALE,
  GUNIV3DAIUSDC1_WHALE,
  GUNIV3DAIUSDC2_WHALE,
  GUNIV3DAIUSDC1_VAULT_WHALE,
} from './constants'
import { whileImpersonating } from '../../../utils/impersonation'
import { advanceBlocks } from '#/test/utils/time'

let collateralAddress: string;

/*
  Define interfaces
*/
interface GUniV3CollateralFixtureContext extends CollateralFixtureContext {
  dai: ERC20Mock
  guniv3daiusdc1: ERC20Mock
}

/*
  Define deployment functions
*/

interface GUniV3CollateralOpts extends CollateralOpts {
  
}

export const defaultGUniV3CollateralOpts: GUniV3CollateralOpts = {
  erc20: GUNIV3DAIUSDC1,
  targetName: ethers.utils.formatBytes32String('DAI'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: DAI_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (
  opts: GUniV3CollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultGUniV3CollateralOpts, ...opts }

  const GUniV3CollateralFactory: ContractFactory = await ethers.getContractFactory(
    'GUniV3Collateral'
  )

  const wrapperTokenFactory = (await ethers.getContractFactory('ERC20Mock'))
  const wrapperToken = await wrapperTokenFactory.deploy('Wrapper Token', 'WT')
  await wrapperToken.deployed()

  const collateral = <TestICollateral>await GUniV3CollateralFactory.deploy(
    {
      erc20: opts.erc20,
      targetName: opts.targetName,
      rewardERC20: opts.rewardERC20,
      priceTimeout: opts.priceTimeout,
      chainlinkFeed: opts.chainlinkFeed,
      oracleError: opts.oracleError,
      oracleTimeout: opts.oracleTimeout,
      maxTradeVolume: opts.maxTradeVolume,
      defaultThreshold: opts.defaultThreshold,
      delayUntilDefault: opts.delayUntilDefault,
    },
    GUNIV3DAIUSDC1_POOL_ILK,
    MCD_VAT,
    MCD_JOIN_GUNIV3DAIUSDC1_A,
    wrapperToken.address,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()
  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  collateralAddress = collateral.address;

  return collateral
}

const chainlinkDefaultAnswer = bn('1800e8')
const chainlinkTargetUnitDefaultAnswer = bn('1e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<GUniV3CollateralFixtureContext> => {
  const collateralOpts = { ...defaultGUniV3CollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    const targetPerRefChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkTargetUnitDefaultAnswer)
    )

    collateralOpts.chainlinkFeed = chainlinkFeed.address
    
    const dai = (await ethers.getContractAt('ERC20Mock', DAI)) as ERC20Mock
    const guniv3daiusdc1 = (await ethers.getContractAt('ERC20Mock', GUNIV3DAIUSDC1)) as ERC20Mock
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    await whileImpersonating(GUNIV3DAIUSDC1_VAULT_WHALE, async (tokenWhale) => {
      await guniv3daiusdc1.connect(tokenWhale).transfer(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('500'))

    })

    return {
      alice,
      collateral,
      chainlinkFeed,
      dai,
      guniv3daiusdc1,
      tok: guniv3daiusdc1,
      rewardToken,
      targetPerRefChainlinkFeed,
    }


  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<GUniV3CollateralFixtureContext> = async (
  ctx: GUniV3CollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintGUNIDAIUSCD(ctx.guniv3daiusdc1, user, amount, recipient)
}

const reduceTargetPerRef = async () => {}

const increaseTargetPerRef = async () => {
  
}

const reduceRefPerTok = async (ctx: GUniV3CollateralFixtureContext, pctDecrease: BigNumberish) => {
  return
}

const increaseRefPerTok = async (
  ctx: GUniV3CollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  advanceBlocks(150)
}

const getExpectedPrice = async (ctx: GUniV3CollateralFixtureContext): Promise<BigNumber> => {
  // UoA/tok feed
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.refPerTok()
  const expectedPegPrice = clData.answer.mul(bn(10).pow(18 - clDecimals))
  console.log({refPerTok})

  const oracle = await ethers.getContractAt("GUniLPOracle", '0x7F6d78CC0040c87943a0e0c140De3F77a273bd58')
  const lastOracleUpdateTimestamp = await oracle.zzz()

  return expectedPegPrice.mul(refPerTok).div(fp('1'))
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {
  
  let GUniV3CollateralFactory: ContractFactory;
  let wrapperToken: Contract;

  const main = async() => {
    const wrapperTokenFactory = (await ethers.getContractFactory('ERC20Mock'))
    wrapperToken = await wrapperTokenFactory.deploy('Wrapper Token', 'WT')
    await wrapperToken.deployed()
    GUniV3CollateralFactory = await ethers.getContractFactory(
      'GUniV3Collateral'
    )
  }
  main()
  
  
  it('does not allow missing pool ilk', async () => {
  
    await expect(GUniV3CollateralFactory.deploy(
      {
        erc20: defaultGUniV3CollateralOpts.erc20,
        targetName: defaultGUniV3CollateralOpts.targetName,
        rewardERC20: defaultGUniV3CollateralOpts.rewardERC20,
        priceTimeout: defaultGUniV3CollateralOpts.priceTimeout,
        chainlinkFeed: defaultGUniV3CollateralOpts.chainlinkFeed,
        oracleError: defaultGUniV3CollateralOpts.oracleError,
        oracleTimeout: defaultGUniV3CollateralOpts.oracleTimeout,
        maxTradeVolume: defaultGUniV3CollateralOpts.maxTradeVolume,
        defaultThreshold: defaultGUniV3CollateralOpts.defaultThreshold,
        delayUntilDefault: defaultGUniV3CollateralOpts.delayUntilDefault,
      },
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      MCD_VAT,
      MCD_JOIN_GUNIV3DAIUSDC1_A,
      wrapperToken.address,
      { gasLimit: 2000000000 }
    )).to.be.revertedWith("poolIlk = 0")

  })

  it ('does not allow missing vat', async () => {

    await expect(GUniV3CollateralFactory.deploy(
      {
        erc20: defaultGUniV3CollateralOpts.erc20,
        targetName: defaultGUniV3CollateralOpts.targetName,
        rewardERC20: defaultGUniV3CollateralOpts.rewardERC20,
        priceTimeout: defaultGUniV3CollateralOpts.priceTimeout,
        chainlinkFeed: defaultGUniV3CollateralOpts.chainlinkFeed,
        oracleError: defaultGUniV3CollateralOpts.oracleError,
        oracleTimeout: defaultGUniV3CollateralOpts.oracleTimeout,
        maxTradeVolume: defaultGUniV3CollateralOpts.maxTradeVolume,
        defaultThreshold: defaultGUniV3CollateralOpts.defaultThreshold,
        delayUntilDefault: defaultGUniV3CollateralOpts.delayUntilDefault,
      },
      GUNIV3DAIUSDC1_POOL_ILK,
      ethers.constants.AddressZero,
      MCD_JOIN_GUNIV3DAIUSDC1_A,
      wrapperToken.address,
      { gasLimit: 2000000000 }
    )).to.be.revertedWith("mcdVat = 0")
  })

  it ('does not allow missing gem join', async () => {

    await expect(GUniV3CollateralFactory.deploy(
      {
        erc20: defaultGUniV3CollateralOpts.erc20,
        targetName: defaultGUniV3CollateralOpts.targetName,
        rewardERC20: defaultGUniV3CollateralOpts.rewardERC20,
        priceTimeout: defaultGUniV3CollateralOpts.priceTimeout,
        chainlinkFeed: defaultGUniV3CollateralOpts.chainlinkFeed,
        oracleError: defaultGUniV3CollateralOpts.oracleError,
        oracleTimeout: defaultGUniV3CollateralOpts.oracleTimeout,
        maxTradeVolume: defaultGUniV3CollateralOpts.maxTradeVolume,
        defaultThreshold: defaultGUniV3CollateralOpts.defaultThreshold,
        delayUntilDefault: defaultGUniV3CollateralOpts.delayUntilDefault,
      },
      GUNIV3DAIUSDC1_POOL_ILK,
      MCD_VAT,
      ethers.constants.AddressZero,
      wrapperToken.address,
      { gasLimit: 2000000000 }
    )).to.be.revertedWith("mcdGemJoin = 0")
  })

}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  let mcdGemJoin: Contract;
  let guniv3daiusdc1: Contract;
  let guniv3collateral: Contract;
  let wrapperToken: Contract;
  let GUniV3CollateralFactory: ContractFactory;

  beforeEach(async () => {
    const wrapperTokenFactory = await ethers.getContractFactory('ERC20PresetMinterPauser')
    wrapperToken = await wrapperTokenFactory.deploy('Wrapper Token', 'WT')
    await wrapperToken.deployed()
    await wrapperToken.mint(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('1'))

    GUniV3CollateralFactory = await ethers.getContractFactory(
      'GUniV3Collateral'
    )
    guniv3collateral =  <TestICollateral>await GUniV3CollateralFactory.deploy(
      {
        erc20: defaultGUniV3CollateralOpts.erc20,
        targetName: defaultGUniV3CollateralOpts.targetName,
        rewardERC20: defaultGUniV3CollateralOpts.rewardERC20,
        priceTimeout: defaultGUniV3CollateralOpts.priceTimeout,
        chainlinkFeed: defaultGUniV3CollateralOpts.chainlinkFeed,
        oracleError: defaultGUniV3CollateralOpts.oracleError,
        oracleTimeout: defaultGUniV3CollateralOpts.oracleTimeout,
        maxTradeVolume: defaultGUniV3CollateralOpts.maxTradeVolume,
        defaultThreshold: defaultGUniV3CollateralOpts.defaultThreshold,
        delayUntilDefault: defaultGUniV3CollateralOpts.delayUntilDefault,
      },
      GUNIV3DAIUSDC1_POOL_ILK,
      MCD_VAT,
      MCD_JOIN_GUNIV3DAIUSDC1_A,
      wrapperToken.address,
      { gasLimit: 2000000000 }
    )

    await guniv3collateral.deployed()

    await wrapperToken.grantRole(await wrapperToken.MINTER_ROLE(), guniv3collateral.address)

    mcdGemJoin = await ethers.getContractAt('GemJoin', MCD_JOIN_GUNIV3DAIUSDC1_A)
    
    guniv3daiusdc1 = (await ethers.getContractAt('ERC20PresetMinterPauser', GUNIV3DAIUSDC1)) as ERC20PresetMinterPauser
  })
  

  

  it ('should deposit GUNIV3 tokens directly', async () => {
    // LOOK FOR ALTERNATIVE WHALES    
    await whileImpersonating(GUNIV3DAIUSDC1_WHALE, async (tokenWhale) => {
      await guniv3daiusdc1.connect(tokenWhale).approve(mcdGemJoin.address, ethers.utils.parseEther('1'))
      const vaultInitialBalance = await guniv3daiusdc1.balanceOf(GUNIV3DAIUSDC1_VAULT_WHALE)

      await mcdGemJoin.connect(tokenWhale).join(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('1'))
      const vaultFinalBalance = await guniv3daiusdc1.balanceOf(mcdGemJoin.address)

      expect(vaultFinalBalance).to.gt(vaultInitialBalance)
    })
    
  })
  it ('should deposit and mint wrapper tokens in a 1:1 rate through a function', async () => {
    
    await whileImpersonating(GUNIV3DAIUSDC1_WHALE, async (tokenWhale) => {
      await guniv3daiusdc1.connect(tokenWhale).approve(guniv3collateral.address, ethers.utils.parseEther('1'))

    })
    
    const wrapperTokenInstance = await ethers.getContractAt('ERC20PresetMinterPauser', wrapperToken.address)

    const vaultInitialBalance = await guniv3daiusdc1.balanceOf(mcdGemJoin.address)

    const whaleInitialWrapperBalance = await wrapperTokenInstance.balanceOf(GUNIV3DAIUSDC1_WHALE)


    await whileImpersonating(GUNIV3DAIUSDC1_WHALE, async (tokenWhale) => {
      await guniv3collateral.connect(tokenWhale).wrappedDeposit(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('1'))
    })


      
      const whaleFinalWrapperBalance = await wrapperTokenInstance.balanceOf(GUNIV3DAIUSDC1_WHALE)
      const vaultFinalBalance = await guniv3daiusdc1.balanceOf(mcdGemJoin.address)

      expect(whaleFinalWrapperBalance).to.gt(whaleInitialWrapperBalance)
      expect(whaleFinalWrapperBalance).to.equal(whaleInitialWrapperBalance.add(ethers.utils.parseEther('1')))
      expect(vaultFinalBalance).to.gt(vaultInitialBalance)
    

  })
  
  it ('should withdraw GUNIV3 tokens directly', async () => {
    await whileImpersonating(GUNIV3DAIUSDC1_WHALE, async (tokenWhale) => {
      await mcdGemJoin.connect(tokenWhale).exit(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('1'))
    })
  })
  it ('should withdraw GUNIV3 tokens indirectly', async () => {

    await whileImpersonating(guniv3collateral.address, async (tokenWhale) => {
      await guniv3daiusdc1.connect(tokenWhale).approve(mcdGemJoin.address, ethers.utils.parseEther('1'))
      await guniv3daiusdc1.connect(tokenWhale).approve(guniv3collateral.address, ethers.utils.parseEther('1'))
    })

    await whileImpersonating(GUNIV3DAIUSDC1_VAULT_WHALE, async (tokenWhale) => {
      await guniv3daiusdc1.connect(tokenWhale).transfer(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('10'))
    })
    await whileImpersonating(GUNIV3DAIUSDC1_WHALE, async (tokenWhale) => {
      
      await guniv3daiusdc1.connect(tokenWhale).approve(guniv3collateral.address, ethers.utils.parseEther('1'))
      await guniv3collateral.connect(tokenWhale).wrappedDeposit(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('1'))
      await wrapperToken.connect(tokenWhale).approve(guniv3collateral.address, ethers.utils.parseEther('1'))
      await guniv3collateral.connect(tokenWhale).wrappedWithdraw(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('1'))
    })
  })
  it ('should burn wrapper tokens in a 1:1 rate while withdrawing', async () => {
    await whileImpersonating(GUNIV3DAIUSDC1_WHALE, async (tokenWhale) => {
      await guniv3daiusdc1.connect(tokenWhale).approve(guniv3collateral.address, ethers.utils.parseEther('1'))
      await guniv3collateral.connect(tokenWhale).wrappedDeposit(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('1'))
      await wrapperToken.connect(tokenWhale).approve(guniv3collateral.address, ethers.utils.parseEther('1'))
    })
    const wrapperTokenInstance = await ethers.getContractAt('ERC20PresetMinterPauser', wrapperToken.address)
    const vaultInitialBalance = await guniv3daiusdc1.balanceOf(mcdGemJoin.address)
    const whaleInitialWrapperBalance = await wrapperTokenInstance.balanceOf(GUNIV3DAIUSDC1_WHALE)
    const userInitialLpBalance = await guniv3daiusdc1.balanceOf(GUNIV3DAIUSDC1_WHALE)


    await whileImpersonating(GUNIV3DAIUSDC1_WHALE, async (tokenWhale) => {
      await guniv3collateral.connect(tokenWhale).wrappedWithdraw(GUNIV3DAIUSDC1_WHALE, ethers.utils.parseEther('1'))
    })

    const vaultFinalBalance = await guniv3daiusdc1.balanceOf(mcdGemJoin.address)
    const wrapperTokenBalanceFinal = await wrapperToken.balanceOf(GUNIV3DAIUSDC1_WHALE);
    const userFinalLpBalance = await guniv3daiusdc1.balanceOf(GUNIV3DAIUSDC1_WHALE)

    expect(wrapperTokenBalanceFinal).to.equal(whaleInitialWrapperBalance.sub(ethers.utils.parseEther('1')))
    expect(vaultFinalBalance).to.equal(vaultInitialBalance.sub(ethers.utils.parseEther('1')))
    expect(userFinalLpBalance).to.equal(userInitialLpBalance.add(ethers.utils.parseEther('1')))

  })}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const beforeEachRewardsTest = async () => {}
/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  beforeEachRewardsTest,
  makeCollateralFixtureContext,
  mintCollateralTo,
  reduceTargetPerRef,
  increaseTargetPerRef,
  reduceRefPerTok,
  increaseRefPerTok,
  getExpectedPrice,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it.skip,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it.skip,
  resetFork,
  collateralName: 'GUniV3Collateral',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
