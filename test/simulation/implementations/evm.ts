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
import { AbstractERC20, AbstractRToken, Account, Component, Simulation, Token } from "../interface"

// WORK IN PROGRESS

// Sample Values for Configuration
const stakingDepositDelay = 3600 // seconds
const stakingWithdrawalDelay = 4800 // seconds
const issuanceRate = pow10(36)
const maxSupply = pow10(36)
const minMintingSize = bn(50)
const spread = bn(0)
const rebalancingFreezeCost = bn(50000)

export class EVMImplementation implements Simulation {
    // TS-IGNORE needed due to empty constructor

    // @ts-ignore
    rToken: RToken // @ts-ignore
    rsr: RSR // @ts-ignore
    iPool: InsurancePool

    async create(owner: SignerWithAddress, rTokenName: string, rTokenSymbol: string, tokens: Token[]): Promise<this> {
        // Circuit Breaker Factory
        const CircuitBreakerFactory = await ethers.getContractFactory("CircuitBreaker")
        const cb = <CircuitBreaker>await CircuitBreakerFactory.deploy(owner.address)

        // RSR (Insurance token)
        const PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock")
        const NewRSR = await ethers.getContractFactory("RSR")
        const prevRSR = <ReserveRightsTokenMock>await PrevRSR.deploy("Reserve Rights", "RSR")
        await prevRSR.connect(owner).pause()
        this.rsr = <RSR>await NewRSR.connect(owner).deploy(prevRSR.address, ZERO_ADDRESS, ZERO_ADDRESS)
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

        // Deploy Basket ERC20s
        const ERC20Factory = await ethers.getContractFactory("ERC20Mock")
        const basketInfo = []
        const basketERC20s: ERC20[] = []
        for (const token of tokens) {
            const tokenDeployment = <ERC20Mock>await ERC20Factory.deploy(token.name, token.symbol)
            const erc20 = new ERC20(tokenDeployment)
            await erc20.init()
            basketERC20s.push(erc20)
            basketInfo.push({
                tokenAddress: tokenDeployment.address,
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
        const rTokenMock = <RTokenMock>await RTokenFactory.connect(owner).deploy()
        await rTokenMock.connect(owner).initialize("RToken", "RTKN", config, basketInfo, rsrInfo)
        this.rToken = new RToken(rTokenMock, basketERC20s)
        await this.rToken.init()
        return this
    }
}

class Base {
    // @ts-ignore
    _signer: SignerWithAddress // @ts-ignore
    _allSigners: Map<Account, SignerWithAddress>

    async init(): Promise<void> {
        const signers = await ethers.getSigners()
        this._allSigners = new Map<Account, SignerWithAddress>([
            [Account.Alice, signers[Account.Alice]],
            [Account.Bob, signers[Account.Bob]],
            [Account.Charlie, signers[Account.Charlie]],
            [Account.Dave, signers[Account.Dave]],
            [Account.Eve, signers[Account.Eve]],
        ])
    }

    signer(sender: Account): SignerWithAddress {
        if (!this._allSigners.has(sender)) {
            console.log(sender)
            throw new Error("Signer unknown")
        }
        return <SignerWithAddress>this._allSigners.get(sender)
    }

    connect(sender: Account): this {
        this._signer = this.signer(sender)
        return this
    }
}

class ERC20 extends Base implements AbstractERC20 {
    erc20: ERC20Mock

    constructor(erc20: ERC20Mock) {
        super()
        this.erc20 = erc20
    }

    balanceOf(account: Account): Promise<BigNumber> {
        return this.erc20.balanceOf(this.signer(account).address)
    }

    async mint(account: Account, amount: BigNumber): Promise<void> {
        await this.erc20.connect(this._signer).mint(this.signer(account).address, amount)
    }

    async burn(account: Account, amount: BigNumber): Promise<void> {
        await this.erc20.connect(this._signer).burn(this.signer(account).address, amount)
    }

    async transfer(to: Account, amount: BigNumber): Promise<void> {
        await this.erc20.connect(this._signer).transfer(this.signer(to).address, amount)
    }
}

class RToken extends Base implements AbstractRToken {
    rToken: RTokenMock
    basketERC20s: ERC20[]

    constructor(rToken: RTokenMock, basketERC20s: ERC20[]) {
        super()
        this.rToken = rToken
        this.basketERC20s = basketERC20s
    }

    // address(): Account {
    //     return this.rToken.address
    // }

    basketERC20(index: number): ERC20 {
        return this.basketERC20s[index]
    }

    balanceOf(account: Account): Promise<BigNumber> {
        return this.rToken.balanceOf(this.signer(account).address)
    }

    async issue(amount: BigNumber): Promise<void> {
        for (let i = 0; i < this.basketERC20s.length; i++) {
            await this.basketERC20(i).erc20.connect(this._signer).approve(this.rToken.address, pow10(36))
        }
        await this.rToken.connect(this._signer).issue(amount)
        await this.rToken.tryProcessMintings()
    }

    async redeem(amount: BigNumber): Promise<void> {
        await this.rToken.connect(this._signer).approve(this.rToken.address, pow10(36))
        await this.rToken.connect(this._signer).redeem(amount)
    }

    async transfer(to: Account, amount: BigNumber): Promise<void> {
        await this.rToken.connect(this._signer).transfer(this.signer(to).address, amount)
    }
}
