import hre, { ethers } from 'hardhat'
import { Signer, Wallet } from "ethers"
import fuzzTests, { Components, FuzzTestContext, componentsOf, FuzzTestFixture } from "./commonTests"
import { NormalOpsScenario } from "@typechain/NormalOpsScenario"
import { MainP1Fuzz } from "@typechain/MainP1Fuzz"
import { impersonateAccount, mine, setBalance, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers"
import { advanceBlocks, advanceTime } from '../utils/time'

const exa = 10n ** 18n // 1e18 in bigInt. "exa" is the SI prefix for 1000 ** 6
const ConAt = ethers.getContractAt
const F = ethers.getContractFactory

type Fixture<T> = () => Promise<T>

const createFixture: Fixture<FuzzTestFixture> = async () => {
    // context variables
    let testType: string = "Normal"

    let scenario: NormalOpsScenario
    let main: MainP1Fuzz
    let comp: Components

    let owner: Wallet
    let alice: Signer
    let bob: Signer
    let carol: Signer

    let aliceAddr: string
    let bobAddr: string
    let carolAddr: string

    let collaterals: string[] = ['C0', 'C1', 'C2']
    let rewards: string[] = ['R0', 'R1']
    let stables: string[] = ['USD0', 'USD1', 'USD2']

    // addrIDs: maps addresses to their address IDs. Inverse of main.someAddr.
    // for any addr the system tracks, main.someAddr(addrIDs(addr)) == addr
    let addrIDs: Map<string, number>

    // tokenIDs: maps token symbols to their token IDs.
    // for any token symbol in the system, main.someToken(tokenIDs(symbol)).symbol() == symbol
    let tokenIDs: Map<string, number>

    let warmupPeriod: number

    const warmup = async () => {
        await advanceTime(warmupPeriod)
        await advanceBlocks(warmupPeriod / 12)
    }

    ;[owner] = (await ethers.getSigners()) as unknown as Wallet[]
    scenario = await (await F('NormalOpsScenario')).deploy({ gasLimit: 0x1ffffffff })
    main = await ConAt('MainP1Fuzz', await scenario.main())
    comp = await componentsOf(main)
    
    addrIDs = new Map()
    let i = 0
    while (true) {
      const address = await main.someAddr(i)
      if (addrIDs.has(address)) break
      addrIDs.set(address, i)
      i++
    }
    
    tokenIDs = new Map()
    i = 0
    while (true) {
      const tokenAddr = await main.someToken(i)
      const token = await ConAt('ERC20Fuzz', tokenAddr)
      const symbol = await token.symbol()
      if (tokenIDs.has(symbol)) break
      tokenIDs.set(symbol, i)
      i++
    }
    
    alice = await ethers.getSigner(await main.users(0))
    bob = await ethers.getSigner(await main.users(1))
    carol = await ethers.getSigner(await main.users(2))
    
    aliceAddr = await alice.getAddress()
    bobAddr = await bob.getAddress()
    carolAddr = await carol.getAddress()
    
    await setBalance(aliceAddr, exa * exa)
    await setBalance(bobAddr, exa * exa)
    await setBalance(carolAddr, exa * exa)
    await setBalance(main.address, exa * exa)
    
    await impersonateAccount(aliceAddr)
    await impersonateAccount(bobAddr)
    await impersonateAccount(carolAddr)
    await impersonateAccount(main.address)
    
    await mine(300, { interval: 12 }) // charge battery
    
    warmupPeriod = await comp.basketHandler.warmupPeriod()
    
    return {
      testType,
      scenario,
      main,
      comp,
      owner,
      alice,
      bob,
      carol,
      aliceAddr,
      bobAddr,
      carolAddr,
      addrIDs,
      tokenIDs,
      warmup,
      collaterals,
      rewards,
      stables
    }
}

const context: FuzzTestContext<FuzzTestFixture> = {
    f: createFixture
}

fuzzTests(context)