import { ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { IImplementations, IGovParams, networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import { useEnv } from '#/utils/env'
import { Implementation, IMPLEMENTATION, ORACLE_ERROR, PRICE_TIMEOUT } from '../../fixtures'
import {
  ActFacet,
  Asset,
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  BasketLibP1,
  BrokerP1,
  DeployerP0,
  DeployerP1,
  DistributorP1,
  DutchTrade,
  ERC20Mock,
  FacadeTest,
  FacadeWrite,
  FurnaceP1,
  GnosisTrade,
  IGnosis,
  MainP1,
  ReadFacet,
  RevenueTraderP1,
  RTokenP1,
  StRSRP1Votes,
  TestIDeployer,
  TestIFacade,
  RecollateralizationLibP1,
} from '../../../typechain'

export const ORACLE_TIMEOUT = bn('500000000') // 5700d - large for tests only

export const ORACLE_TIMEOUT_BUFFER = 300

export const DECAY_DELAY = ORACLE_TIMEOUT.add(ORACLE_TIMEOUT_BUFFER)

export type Fixture<T> = () => Promise<T>

interface RSRFixture {
  rsr: ERC20Mock
}

async function rsrFixture(chainId: number): Promise<RSRFixture> {
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

export interface DefaultFixture extends RSRAndModuleFixture {
  salt: string
  deployer: TestIDeployer
  rsrAsset: Asset
  facade: TestIFacade
  facadeTest: FacadeTest
  facadeWrite: FacadeWrite
  govParams: IGovParams
}

export const getDefaultFixture = async function (salt: string) {
  const defaultFixture: Fixture<DefaultFixture> = async function (): Promise<DefaultFixture> {
    let chainId = await getChainId(hre)
    if (useEnv('FORK_NETWORK').toLowerCase() == 'base') chainId = 8453
    if (useEnv('FORK_NETWORK').toLowerCase() == 'arbitrum') chainId = 42161
    const { rsr } = await rsrFixture(chainId)
    const { gnosis } = await gnosisFixture()
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }

    // Deploy Facade
    const FacadeFactory: ContractFactory = await ethers.getContractFactory('Facade')
    const facade = await ethers.getContractAt('TestIFacade', (await FacadeFactory.deploy()).address)

    // Save ReadFacet to Facade
    const ReadFacetFactory: ContractFactory = await ethers.getContractFactory('ReadFacet')
    const readFacet = <ReadFacet>await ReadFacetFactory.deploy()
    await facade.save(
      readFacet.address,
      Object.entries(readFacet.functions).map(([fn]) => readFacet.interface.getSighash(fn))
    )

    // Save ActFacet to Facade
    const ActFacetFactory: ContractFactory = await ethers.getContractFactory('ActFacet')
    const actFacet = <ActFacet>await ActFacetFactory.deploy()
    await facade.save(
      actFacet.address,
      Object.entries(actFacet.functions).map(([fn]) => actFacet.interface.getSighash(fn))
    )

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

    // Deploy BasketLib external library
    const BasketLibFactory: ContractFactory = await ethers.getContractFactory('BasketLibP1')
    const basketLib: BasketLibP1 = <BasketLibP1>await BasketLibFactory.deploy()

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

      const AssetRegImplFactory: ContractFactory = await ethers.getContractFactory(
        'AssetRegistryP1'
      )
      const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

      const BackingMgrImplFactory: ContractFactory = await ethers.getContractFactory(
        'BackingManagerP1',
        {
          libraries: {
            RecollateralizationLibP1: tradingLib.address,
          },
        }
      )
      const backingMgrImpl: BackingManagerP1 = <BackingManagerP1>(
        await BackingMgrImplFactory.deploy()
      )

      const BskHandlerImplFactory: ContractFactory = await ethers.getContractFactory(
        'BasketHandlerP1',
        { libraries: { BasketLibP1: basketLib.address } }
      )
      const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

      const DistribImplFactory: ContractFactory = await ethers.getContractFactory('DistributorP1')
      const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

      const RevTraderImplFactory: ContractFactory = await ethers.getContractFactory(
        'RevenueTraderP1'
      )
      const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

      const FurnaceImplFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
      const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

      const GnosisTradeImplFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
      const gnosisTrade: GnosisTrade = <GnosisTrade>await GnosisTradeImplFactory.deploy()

      const DutchTradeImplFactory: ContractFactory = await ethers.getContractFactory('DutchTrade')
      const dutchTrade: DutchTrade = <DutchTrade>await DutchTradeImplFactory.deploy()

      const BrokerImplFactory: ContractFactory = await ethers.getContractFactory('BrokerP1')
      const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

      const RTokenImplFactory: ContractFactory = await ethers.getContractFactory('RTokenP1')
      const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

      const StRSRImplFactory: ContractFactory = await ethers.getContractFactory('StRSRP1Votes')
      const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

      // Setup Implementation addresses
      const implementations: IImplementations = {
        main: mainImpl.address,
        trading: { gnosisTrade: gnosisTrade.address, dutchTrade: dutchTrade.address },
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
      salt,
      rsr,
      rsrAsset,
      deployer,
      gnosis,
      facade,
      facadeTest,
      facadeWrite,
      govParams,
    }
  }
  return defaultFixture
}
