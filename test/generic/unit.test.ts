import * as _ from 'lodash'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber } from 'ethers'
import { getLatestBlockTimestamp } from '../utils/time'
import { bn, fp } from '../../common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ComptrollerMockP0 } from '../../typechain/ComptrollerMockP0'
import { AaveLendingPoolMockP0 } from '../../typechain/AaveLendingPoolMockP0'
import { CompoundOracleMockP0 } from '../../typechain/CompoundOracleMockP0'
import { AaveOracleMockP0 } from '../../typechain/AaveOracleMockP0'
import { AaveLendingAddrProviderMockP0 } from '../../typechain/AaveLendingAddrProviderMockP0'
import { ProtoDriver } from '../../typechain/ProtoDriver'
import { AdapterP0 } from '../../typechain/AdapterP0'
import { IManagerConfig } from '../p0/utils/fixtures'

// Must match `ProtoState.CollateralToken`
enum CollateralToken {
  DAI,
  USDC,
  USDT,
  BUSD,
  cDAI,
  cUSDC,
  cUSDT,
  aDAI,
  aUSDC,
  aUSDT,
  aBUSD,
}

// Must match `ProtoState.Account`
enum Account {
  ALICE,
  BOB,
  CHARLIE,
  DAVE,
  EVE,
  //
  RTOKEN,
  STRSR,
  MAIN,
}

// Inserts all allowance triples into a 2d array using accounts to determine indices
const allowance2D = (...allowance: Array<[Account, Account, BigNumber]>) => {
  const toReturn: BigNumber[][] = [] // 2d
  for (let i = 0; i < Account.MAIN + 1; i++) {
    toReturn[i] = []
    for (let j = 0; j < Account.MAIN + 1; j++) {
      toReturn[i][j] = bn(0)
    }
  }
  for (let i = 0; i < allowance.length; i++) {
    toReturn[allowance[i][0]][allowance[i][1]] = allowance[i][2]
  }
  return toReturn
}

describe('Generic unit tests', () => {
  let owner: SignerWithAddress
  let compoundOracle: CompoundOracleMockP0
  let aaveOracle: AaveOracleMockP0
  let comptroller: ComptrollerMockP0
  let aaveLendingPool: AaveLendingPoolMockP0
  let config: IManagerConfig

  let P0: ContractFactory

  beforeEach(async () => {
    ;[owner] = await ethers.getSigners()

    P0 = await ethers.getContractFactory('AdapterP0')

    // Config
    config = {
      rewardStart: bn(await getLatestBlockTimestamp()),
      rewardPeriod: bn('604800'), // 1 week
      auctionPeriod: bn('1800'), // 30 minutes
      stRSRWithdrawalDelay: bn('1209600'), // 2 weeks
      defaultDelay: bn('86400'), // 24 hrs
      maxTradeSlippage: fp('0.05'), // 5%
      maxAuctionSize: fp('0.01'), // 1%
      minRecapitalizationAuctionSize: fp('0.001'), // 0.1%
      minRevenueAuctionSize: fp('0.0001'), // 0.01%
      migrationChunk: fp('0.2'), // 20%
      issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
      defaultThreshold: fp('0.05'), // 5% deviation
      f: fp('0.60'), // 60% to stakers
    }

    // Compound
    const CompoundOracle = await ethers.getContractFactory('CompoundOracleMockP0')
    compoundOracle = <CompoundOracleMockP0>await CompoundOracle.connect(owner).deploy()
    const Comptroller = await ethers.getContractFactory('ComptrollerMockP0')
    comptroller = <ComptrollerMockP0>await Comptroller.connect(owner).deploy(compoundOracle.address)

    // Aave
    const Weth = await ethers.getContractFactory('ERC20Mock')
    const weth = await Weth.connect(owner).deploy('Wrapped ETH', 'WETH')
    const AaveOracle = await ethers.getContractFactory('AaveOracleMockP0')
    aaveOracle = <AaveOracleMockP0>await AaveOracle.connect(owner).deploy(weth.address)
    const AaveAddrProvider = await ethers.getContractFactory('AaveLendingAddrProviderMockP0')
    const aaveAddrProvider = await AaveAddrProvider.connect(owner).deploy(aaveOracle.address)
    const AaveLendingPool = await ethers.getContractFactory('AaveLendingPoolMockP0')
    aaveLendingPool = <AaveLendingPoolMockP0>await AaveLendingPool.connect(owner).deploy(aaveAddrProvider.address)
  })

  describe('Setup', () => {
    let p0: ProtoDriver
    let initialState: any

    beforeEach(async () => {
      const rToken = { name: 'USD+ RToken', symbol: 'USD+', balances: [], allowances: allowance2D(), totalSupply: 0 }
      const rsr = {
        name: 'Reserve Rights Token',
        symbol: 'RSR',
        balances: [],
        allowances: allowance2D(),
        totalSupply: 0,
      }
      const stRSR = { name: 'Staked RSR', symbol: 'stRSR', balances: [], allowances: allowance2D(), totalSupply: 0 }
      const comp = {
        name: 'Compound Token',
        symbol: 'COMP',
        balances: [],
        allowances: allowance2D(),
        totalSupply: 0,
      }
      const aave = { name: 'Aave Token', symbol: 'AAVE', balances: [], allowances: allowance2D(), totalSupply: 0 }
      const collateral = [
        {
          name: 'DAI Token',
          symbol: CollateralToken[CollateralToken.DAI],
          balances: [bn('1e36'), 0, 0, 0, 0, 0, 0, 0],
          allowances: allowance2D([Account.ALICE, Account.MAIN, bn('1e36')], [Account.ALICE, Account.BOB, bn('1e36')]),
          totalSupply: 0,
        },
        {
          name: 'USDC Token',
          symbol: CollateralToken[CollateralToken.USDC],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
        {
          name: 'USDT Token',
          symbol: CollateralToken[CollateralToken.USDT],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
        {
          name: 'BUSD Token',
          symbol: CollateralToken[CollateralToken.BUSD],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
        {
          name: 'cDAI Token',
          symbol: CollateralToken[CollateralToken.cDAI],
          balances: [bn('1e36'), 0, 0, 0, 0, 0, 0, 0],
          allowances: allowance2D([Account.ALICE, Account.MAIN, bn('1e36')]),
          totalSupply: 0,
        },
        {
          name: 'cUSDC Token',
          symbol: CollateralToken[CollateralToken.cUSDC],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
        {
          name: 'cUSDT Token',
          symbol: CollateralToken[CollateralToken.cUSDT],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
        {
          name: 'aDAI Token',
          symbol: CollateralToken[CollateralToken.aDAI],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
        {
          name: 'aUSDC Token',
          symbol: CollateralToken[CollateralToken.aUSDC],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
        {
          name: 'aUSDT Token',
          symbol: CollateralToken[CollateralToken.aUSDT],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
        {
          name: 'aBUSD Token',
          symbol: CollateralToken[CollateralToken.aBUSD],
          balances: [],
          allowances: allowance2D(),
          totalSupply: 0,
        },
      ]

      const b1 = { tokens: [CollateralToken.cDAI, CollateralToken.DAI], quantities: [bn('5e7'), bn('5e17')] }
      const b2 = { tokens: [CollateralToken.DAI], quantities: [bn('1e18')] }
      const baskets = [b1, b2]

      initialState = {
        config: config,
        comptroller: comptroller.address,
        aaveLendingPool: aaveLendingPool.address,
        baskets: baskets,
        //
        rTokenRedemption: b1,
        rToken: rToken,
        rsr: rsr,
        stRSR: stRSR,
        comp: comp,
        aave: aave,
        collateral: collateral,
      }

      p0 = <AdapterP0>await P0.deploy()
      console.log(initialState)
      console.log(initialState.collateral[0].allowances)
      await p0.init(initialState)
    })

    it('Should output initialState intially', async () => {
      const state = await p0.callStatic.state()
      expect(_.eq(state, initialState)).to.equal(true)
    })
    it('Should issue', async () => {
      await p0.CMD_issue(Account.ALICE, bn('1e18'))
      const state = await p0.callStatic.state()
      console.log(allowance2D([Account.ALICE, Account.BOB, bn('1e36')]))
      expect(state.rToken.balances[Account.ALICE]).to.equal(bn('1e18'))

      // expect(await rTokenAsset.callStatic.priceUSD(main.address)).to.equal(fp('1'))
    })
  })
})
