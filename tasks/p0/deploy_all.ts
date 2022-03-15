import { GnosisMock } from '@typechain/GnosisMock'
import { ContractFactory } from 'ethers'
import { task } from 'hardhat/config'
import { expectInReceipt } from '../../common/events'
import { bn, fp } from '../../common/numbers'
import { IConfig } from '../../test/p0/utils/fixtures'
import {
  AssetRegistryP0,
  ATokenFiatCollateral,
  BasketHandlerP0,
  CTokenFiatCollateral,
  DeployerP0,
  MainP0,
} from '../../typechain'

const defaultThreshold = fp('0.05') // 5%
const delayUntilDefault = bn('86400') // 24h
const AAVE_ADDRESS = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
const COMP_ADDRESS = '0xc00e94cb662c3520282e6f5717214004a7f26888'

// Setup Config
const config: IConfig = {
  maxAuctionSize: fp('1e6'), // $1M
  dist: {
    rTokenDist: bn(40), // 2/5 RToken
    rsrDist: bn(60), // 3/5 RSR
  },
  rewardPeriod: bn('604800'), // 1 week
  rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
  unstakingDelay: bn('1209600'), // 2 weeks
  auctionDelay: bn('0'), // (the delay _after_ default has been confirmed)
  auctionLength: bn('1800'), // 30 minutes
  backingBuffer: fp('0.0001'), // 0.01%
  maxTradeSlippage: fp('0.01'), // 1%
  dustAmount: fp('0.01'), // 0.01 UoA (USD)
  issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
}

task('Proto0-deployAll', 'Deploys all p0 contracts and a mock RToken').setAction(
  async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()
    // Dependencies
    console.log('Deploying market mock')
    // Market
    // TODO: Real market
    const GnosisMockFactory: ContractFactory = await hre.ethers.getContractFactory('GnosisMock')
    const marketMock: GnosisMock = <GnosisMock>await GnosisMockFactory.deploy()

    console.log('Deploying RToken deployer...')
    // Create Deployer
    const DeployerFactory = <ContractFactory>await hre.ethers.getContractFactory('DeployerP0')
    const rtokenDeployer = <DeployerP0>await DeployerFactory.connect(deployer).deploy(
      '0x320623b8e4ff03373931769a31fc52a4e78b5d70', // RSR
      COMP_ADDRESS, // COMP
      AAVE_ADDRESS, // AAVE
      marketMock.address, // Mock Market (Auctions)
      '0x02557a5E05DeFeFFD4cAe6D83eA3d173B272c904', // COMP ORACLE
      '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9' // AAVE ORACLE
    )
    await rtokenDeployer.deployed()

    console.log('Deploying RToken...')
    // Deploy actual contracts
    const receipt = await (
      await rtokenDeployer.deploy('Reserve Dollar Plus', 'RSDP', deployer.address, config)
    ).wait()

    // Get main and facade addresses
    const { main: mainAddr, facade: facadeAddr } = expectInReceipt(receipt, 'RTokenCreated').args

    // Get Core
    const main = <MainP0>await hre.ethers.getContractAt('MainP0', mainAddr)
    const rTokenAddr = await main.rToken()
    const stRSRAddr = await main.stRSR()
    const assetRegistry = <AssetRegistryP0>(
      await hre.ethers.getContractAt('AssetRegistryP0', await main.assetRegistry())
    )
    const basketHandler = <BasketHandlerP0>(
      await hre.ethers.getContractAt('BasketHandlerP0', await main.basketHandler())
    )

    const ATokenCollateralFactory = await hre.ethers.getContractFactory('ATokenFiatCollateral')
    const CTokenCollateralFactory = await hre.ethers.getContractFactory('CTokenFiatCollateral')

    const basket = [
      '0xfC1E690f61EFd961294b3e1Ce3313fBD8aa4f85d', // aDAI
      '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9', // cUSDT
      '0x39aa39c021dfbae8fac545936693ac917d5e7563', // cUSDC
    ]

    const fiat = [
      '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
      '0x6b175474e89094c44da98b954eedeac495271d0f', // USDC
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    ]

    const basketsNeededAmts = [fp('0.33'), fp('0.33'), fp('0.34')]

    const collaterals: string[] = []

    console.log('Deploying basket collaterals...')
    // Deploy collaterals
    for (let i = 0; i < basket.length; i++) {
      let collateral: ATokenFiatCollateral | CTokenFiatCollateral
      const params = [
        basket[i],
        config.maxAuctionSize,
        defaultThreshold,
        delayUntilDefault,
        fiat[i],
        '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B', // comptroller
      ] as const

      if (i === 0) {
        collateral = <ATokenFiatCollateral>await ATokenCollateralFactory.deploy(
          ...params,
          '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', // Aave lending pool
          AAVE_ADDRESS
        )
      } else {
        collateral = <CTokenFiatCollateral>(
          await CTokenCollateralFactory.deploy(...params, COMP_ADDRESS)
        )
      }

      await collateral.deployed()
      collaterals.push(collateral.address)
    }

    console.log('Setting basket...')
    // Register prime collateral
    for (let i = 0; i < basket.length; i++) {
      await assetRegistry.connect(deployer).register(collaterals[i])
    }

    // Set non-empty basket
    await basketHandler.connect(deployer).setPrimeBasket(basket, basketsNeededAmts)
    await basketHandler.connect(deployer).switchBasket()

    console.log('Unpausing...')
    await main.connect(deployer).unpause()

    console.log(`
    -------------------------
    Reserve Proto0 - Deployed
    -------------------------
    RTOKEN_DEPLOYER - ${rtokenDeployer.address}
    FACADE          - ${facadeAddr}
    MAIN            - ${main.address}
    RTOKEN          - ${rTokenAddr}
    stRSR           - ${stRSRAddr}
    -------------------------
  `)

    return main
  }
)
