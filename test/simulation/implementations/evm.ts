import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { advanceTime } from "../../utils/time"
import { bn, pow10 } from "../../../common/numbers"
import { ZERO_ADDRESS } from "../../../common/constants"
import { ERC20Mock } from "../../../typechain/ERC20Mock.d"
import { CircuitBreaker } from "../../../typechain/CircuitBreaker.d"
import { ReserveRightsTokenMock } from "../../../typechain/ReserveRightsTokenMock.d"
import { RSR } from "../../../typechain/RSR.d"
import { RTokenMock } from "../../../typechain/RTokenMock.d"
import { IRTokenParams } from "../../../common/configuration"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Account, Command, Contract, Simulation, State, Token, RTokenState, Users, User } from "../interface"

// Sample Values for Configuration
const stakingDepositDelay = 3600 // seconds
const stakingWithdrawalDelay = 4800 // seconds
const issuanceRate = pow10(36)
const maxSupply = pow10(36)
const minMintingSize = bn(50)
const spread = bn(0)
const rebalancingFreezeCost = bn(50000)

// Used for switching between simulation interface and EVM concepts.
class AccountInterpreter {
    // @ts-ignore
    addresses: Map<Account, string> // @ts-ignore
    signers: Map<User, SignerWithAddress> // @ts-ignore
    accountsByAddresses: Map<string, Account>

    async init(): Promise<void> {
        const signers = await ethers.getSigners()
        this.signers = new Map<User, SignerWithAddress>(Users.map((u: User, i: number) => [u, signers[i]]))
        this.addresses = new Map<Account, string>()
        this.accountsByAddresses = new Map<string, Account>()
        this.signers.forEach((value: SignerWithAddress, key: User) => {
            this.addresses.set(key, value.address)
            this.accountsByAddresses.set(value.address, key)
        })
    }

    registerContract(contract: Contract, address: string): void {
        this.addresses.set(contract, address)
        this.accountsByAddresses.set(address, contract)
    }

    signer(user: User): SignerWithAddress {
        if (!this.signers.has(user)) {
            console.log("user", user)
            throw new Error("User unknown")
        }
        return <SignerWithAddress>this.signers.get(user)
    }

    address(account: Account): string {
        if (!this.addresses.has(account)) {
            console.log("account", account)
            throw new Error("Invalid account")
        }
        return this.addresses.get(account) as string
    }

    account(address: string): Account {
        if (!this.accountsByAddresses.has(address)) {
            console.log("address", address)
            throw new Error("Unknown address")
        }
        return this.accountsByAddresses.get(address) as Account
    }
}

// Global to all the following classes.
const interpreter = new AccountInterpreter()

export class EVMImplementation implements Simulation {
    // TS-IGNORE needed due to empty constructor

    // @ts-ignore
    rToken: RToken // @ts-ignore
    rsr: RSR // @ts-ignore
    iPool: InsurancePool

    async seed(deployer: User, state: State): Promise<void> {
        await interpreter.init()
        const signer = interpreter.signer(deployer)

        // Circuit Breaker Factory
        const CircuitBreakerFactory = await ethers.getContractFactory("CircuitBreaker")
        const cb = <CircuitBreaker>await CircuitBreakerFactory.deploy(signer.address)

        // RSR (Insurance token)
        const PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock")
        const NewRSR = await ethers.getContractFactory("RSR")
        const prevRSR = <ReserveRightsTokenMock>await PrevRSR.deploy("Reserve Rights", "RSR")
        await prevRSR.connect(signer).pause()
        this.rsr = <RSR>await NewRSR.connect(signer).deploy(prevRSR.address, ZERO_ADDRESS, ZERO_ADDRESS)
        // Set RSR token info
        const rsrInfo = {
            tokenAddress: this.rsr.address,
            genesisQuantity: 0,
            rateLimit: 1,
            maxTrade: 1,
            priceInRToken: 0,
            slippageTolerance: 0,
        }

        // External math lib
        const CompoundMath = await ethers.getContractFactory("CompoundMath")
        const math = await CompoundMath.deploy()

        // Deploy Basket ERC20s and give deployer initial balances.
        const ERC20Factory = await ethers.getContractFactory("ERC20Mock")
        const basketInfo = []
        const basketERC20s: ERC20Mock[] = []
        for (const token of state.rToken.basket) {
            const erc20 = <ERC20Mock>await ERC20Factory.deploy(token.name, token.symbol)
            await erc20.mint(signer.address, pow10(36))
            basketERC20s.push(erc20)
            basketInfo.push({
                tokenAddress: erc20.address,
                genesisQuantity: token.quantityE18,
                rateLimit: 1,
                maxTrade: 1,
                priceInRToken: 0,
                slippageTolerance: 0,
            })
        }

        // Deploy RToken
        const config: IRTokenParams = {
            stakingDepositDelay,
            stakingWithdrawalDelay: stakingWithdrawalDelay,
            maxSupply: maxSupply,
            minMintingSize: minMintingSize,
            issuanceRate: issuanceRate,
            rebalancingFreezeCost: rebalancingFreezeCost,
            insurancePaymentPeriod: 0,
            expansionPerSecond: 0,
            expenditureFactor: 0,
            spread: spread,
            exchange: ZERO_ADDRESS,
            circuitBreaker: cb.address,
            txFeeCalculator: ZERO_ADDRESS,
            insurancePool: ZERO_ADDRESS,
            protocolFund: ZERO_ADDRESS,
        }
        const RTokenFactory = await ethers.getContractFactory("RTokenMock", {
            libraries: {
                CompoundMath: math.address,
            },
        })
        const rTokenMock = <RTokenMock>await RTokenFactory.connect(signer).deploy()
        await rTokenMock.connect(signer).initialize("RToken", "RTKN", config, basketInfo, rsrInfo)
        this.rToken = new RToken(rTokenMock, basketERC20s)

        interpreter.registerContract(Contract.RToken, this.rToken.rToken.address)
        interpreter.registerContract(Contract.RSR, this.rsr.address)
    }

    // Interprets a Command as a function call, optionally originating from an account.
    async execute(user: User, command: Command): Promise<any> {
        const key = Object.keys(command)[0]
        const subtree = command[key as keyof Command]
        const func = Object.keys(subtree as Object)[0] // @ts-ignore
        const args = subtree[func]
        console.log("execute", key, func)
        // @ts-ignored
        return await this[key][func](user, ...args)
    }

    async state(): Promise<State> {
        return {
            rToken: await this.rToken.state(),
        }
    }
}

class RToken {
    rToken: RTokenMock
    basketERC20s: ERC20Mock[]
    trackedAccounts: Set<Account>

    constructor(rToken: RTokenMock, basketERC20s: ERC20Mock[]) {
        this.rToken = rToken
        this.basketERC20s = basketERC20s
        this.trackedAccounts = new Set<Account>()
    }

    balanceOf(account: Account): Promise<BigNumber> {
        return this.rToken.balanceOf(interpreter.address(account))
    }

    async issue(user: User, amount: BigNumber): Promise<void> {
        this.trackedAccounts.add(user)
        for (let i = 0; i < this.basketERC20s.length; i++) {
            await this.basketERC20s[i].connect(interpreter.signer(user)).approve(this.rToken.address, pow10(36))
        }
        await this.rToken.connect(interpreter.signer(user)).issue(amount)
        await this.rToken.tryProcessMintings()
    }

    async redeem(user: User, amount: BigNumber): Promise<void> {
        await this.rToken.connect(interpreter.signer(user)).approve(this.rToken.address, pow10(36))
        await this.rToken.connect(interpreter.signer(user)).redeem(amount)
    }

    async transfer(user: User, to: Account, amount: BigNumber): Promise<void> {
        this.trackedAccounts.add(to)
        await this.rToken.connect(interpreter.signer(user)).transfer(interpreter.address(to), amount)
    }

    async balances(): Promise<Map<Account, BigNumber>> {
        const balances = new Map<Account, BigNumber>()
        for (const account of this.trackedAccounts) {
            balances.set(account, await this.rToken.balanceOf(interpreter.address(account)))
        }
        return balances
    }

    async state(): Promise<RTokenState> {
        const basket: Token[] = []
        for (let i = 0; i < (await this.rToken.basketSize()); i++) {
            const [, quantity, , , ,] = await this.rToken.basketToken(i)
            basket.push({
                name: await this.basketERC20s[i].name(),
                symbol: await this.basketERC20s[i].symbol(),
                quantityE18: quantity,
            })
        }
        return { basket: basket, balances: await this.balances() }
    }
}
