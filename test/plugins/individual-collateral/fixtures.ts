import { ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { IImplementations, IGovParams, networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import { Implementation, IMPLEMENTATION, ORACLE_ERROR, PRICE_TIMEOUT } from '../../fixtures'
import {
  Asset,
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  BrokerP1,
  DeployerP0,
  DeployerP1,
  DistributorP1,
  ERC20Mock,
  FacadeRead,
  FacadeAct,
  FacadeTest,
  FacadeWrite,
  FurnaceP1,
  GnosisTrade,
  IGnosis,
  MainP1,
  RevenueTraderP1,
  RTokenP1,
  StRSRP1Votes,
  TestIDeployer,
  RecollateralizationLibP1,
} from '../../../typechain'

export const ORACLE_TIMEOUT = bn('500000000') // 5700d - large for tests only

type Fixture<T> = () => Promise<T>

interface RSRFixture {
  rsr: ERC20Mock
}

async function rsrFixture(): Promise<RSRFixture> {
  const chainId = await getChainId(hre)
  const rsr: ERC20Mock = <ERC20Mock>(
    await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.RSR || '')
  )
  return { rsr }
}

interface ModuleFixture {
  gnosis: IGnosis
}

async function gnosisFixture(): Promise<ModuleFixture> {
  const EasyAuctionFactory: ContractFactory = await ethers.getContractFactory('EasyAuction')
  const gnosis: IGnosis = <IGnosis>await EasyAuctionFactory.deploy()
  return { gnosis: gnosis }
}

type RSRAndModuleFixture = RSRFixture & ModuleFixture

interface DefaultFixture extends RSRAndModuleFixture {
  deployer: TestIDeployer
  rsrAsset: Asset
  facade: FacadeRead
  facadeAct: FacadeAct
  facadeTest: FacadeTest
  facadeWrite: FacadeWrite
  govParams: IGovParams
}

export const defaultFixture: Fixture<DefaultFixture> = async function (): Promise<DefaultFixture> {
  const { rsr } = await rsrFixture()
  const { gnosis } = await gnosisFixture()
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Deploy FacadeRead
  const FacadeReadFactory: ContractFactory = await ethers.getContractFactory('FacadeRead')
  const facade = <FacadeRead>await FacadeReadFactory.deploy()

  // Deploy FacadeAct
  const FacadeActFactory: ContractFactory = await ethers.getContractFactory('FacadeAct')
  const facadeAct = <FacadeAct>await FacadeActFactory.deploy()

  // Deploy FacadeTest
  const FacadeTestFactory: ContractFactory = await ethers.getContractFactory('FacadeTest')
  const facadeTest = <FacadeTest>await FacadeTestFactory.deploy()

  // Deploy TradingLib external library
  const TradingLibFactory: ContractFactory = await ethers.getContractFactory(
    'RecollateralizationLibP1'
  )
  const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
    await TradingLibFactory.deploy()
  )

  // Deploy FacadeWriteLib external library
  const facadeWriteLib = await (await ethers.getContractFactory('FacadeWriteLib')).deploy()

  // Deploy RSR Asset
  const AssetFactory: ContractFactory = await ethers.getContractFactory('Asset')
  const rsrAsset: Asset = <Asset>await AssetFactory.deploy(
    PRICE_TIMEOUT,
    networkConfig[chainId].chainlinkFeeds.RSR || '',
    ORACLE_ERROR,
    rsr.address,
    fp('1e6'), // max trade volume
    ORACLE_TIMEOUT
  )

  // Create Deployer
  const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP0', {
    libraries: { TradingLibP0: tradingLib.address },
  })
  let deployer: TestIDeployer = <DeployerP0>(
    await DeployerFactory.deploy(rsr.address, gnosis.address, rsrAsset.address)
  )

  if (IMPLEMENTATION == Implementation.P1) {
    // Deploy implementations
    const MainImplFactory: ContractFactory = await ethers.getContractFactory('MainP1')
    const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

    const AssetRegImplFactory: ContractFactory = await ethers.getContractFactory('AssetRegistryP1')
    const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

    const BackingMgrImplFactory: ContractFactory = await ethers.getContractFactory(
      'BackingManagerP1',
      {
        libraries: {
          RecollateralizationLibP1: tradingLib.address,
        },
      }
    )
    const backingMgrImpl: BackingManagerP1 = <BackingManagerP1>await BackingMgrImplFactory.deploy()

    const BskHandlerImplFactory: ContractFactory = await ethers.getContractFactory(
      'BasketHandlerP1'
    )
    const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

    const DistribImplFactory: ContractFactory = await ethers.getContractFactory('DistributorP1')
    const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

    const RevTraderImplFactory: ContractFactory = await ethers.getContractFactory('RevenueTraderP1')
    const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

    const FurnaceImplFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
    const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

    const TradeImplFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
    const tradeImpl: GnosisTrade = <GnosisTrade>await TradeImplFactory.deploy()

    const BrokerImplFactory: ContractFactory = await ethers.getContractFactory('BrokerP1')
    const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

    const RTokenImplFactory: ContractFactory = await ethers.getContractFactory('RTokenP1')
    const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

    const StRSRImplFactory: ContractFactory = await ethers.getContractFactory('StRSRP1Votes')
    const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

    // Setup Implementation addresses
    const implementations: IImplementations = {
      main: mainImpl.address,
      trade: tradeImpl.address,
      components: {
        assetRegistry: assetRegImpl.address,
        backingManager: backingMgrImpl.address,
        basketHandler: bskHndlrImpl.address,
        broker: brokerImpl.address,
        distributor: distribImpl.address,
        furnace: furnaceImpl.address,
        rsrTrader: revTraderImpl.address,
        rTokenTrader: revTraderImpl.address,
        rToken: rTokenImpl.address,
        stRSR: stRSRImpl.address,
      },
    }

    const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
    deployer = <DeployerP1>(
      await DeployerFactory.deploy(rsr.address, gnosis.address, rsrAsset.address, implementations)
    )
  }

  // Deploy Facade
  const FacadeWriteFactory: ContractFactory = await ethers.getContractFactory('FacadeWrite', {
    libraries: {
      FacadeWriteLib: facadeWriteLib.address,
    },
  })
  const facadeWrite = <FacadeWrite>await FacadeWriteFactory.deploy(deployer.address)

  // Set default governance params - not used in tests
  const govParams: IGovParams = {
    votingDelay: bn(5), // 5 blocks
    votingPeriod: bn(100), // 100 blocks
    proposalThresholdAsMicroPercent: bn(1e6), // 1%
    quorumPercent: bn(4), // 4%
    timelockDelay: bn(60 * 60 * 24), // 1 day
  }

  return {
    rsr,
    rsrAsset,
    deployer,
    gnosis,
    facade,
    facadeAct,
    facadeTest,
    facadeWrite,
    govParams,
  }
}
