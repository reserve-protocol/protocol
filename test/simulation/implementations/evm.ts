import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, ContractFactory } from "ethers"
import { bn } from "../../../common/numbers"
import { ZERO_ADDRESS } from "../../../common/constants"
import { ERC20Mock } from "../../../typechain/ERC20Mock.d"
import { CircuitBreaker } from "../../../typechain/CircuitBreaker.d"
import { ReserveRightsTokenMock } from "../../../typechain/ReserveRightsTokenMock.d"
import { RSR } from "../../../typechain/RSR.d"
import { RTokenMock } from "../../../typechain/RTokenMock.d"
import { TXFeeCalculatorMock } from "../../../typechain/TXFeeCalculatorMock.d"
import { IBasketToken, IRTokenConfig, IRSRConfig, IRTokenParams } from "../../../common/configuration"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { AbstractERC20, Address, Component, Simulation, Token } from "../interface"

// WORK IN PROGRESS

class Base implements Component {
    // @ts-ignore
    _signer: SignerWithAddress // @ts-ignore
    _allSigners: Map<Address, SignerWithAddress> // @ts-ignore
    address: Address

    async init(address: Address): Promise<void> {
        this.address = address
        this._allSigners = new Map<Address, SignerWithAddress>()
        const signers = await ethers.getSigners()
        for (const signer of signers) {
            this._allSigners.set(signer.address, signer)
        }
    }

    connect(sender: Address): this {
        if (!this._allSigners.has(sender)) {
            throw new Error("Signer unknown")
        }
        this._signer = <SignerWithAddress>this._allSigners.get(sender)
        return this
    }
}

// Sample Values for Configuration
const stakingDepositDelay = 3600 // seconds
const stakingWithdrawalDelay = 4800 // seconds
const issuanceRate = bn(25000)
const maxSupply = bn(100000)
const minMintingSize = bn(50)
const spread = bn(10)
const rebalancingFreezeCost = bn(50000)

export class EVMImplementation extends Base implements Simulation {
    // TS-IGNORE necessary due to empty constructor

    // @ts-ignore
    owner: SignerWithAddress // @ts-ignore

    rToken: ERC20 // @ts-ignore
    cb: CircuitBreaker // @ts-ignore
    rsr: RSR // @ts-ignore

    async create(owner: SignerWithAddress, rTokenName: string, rTokenSymbol: string, tokens: Token[]): Promise<void> {
        this.owner = owner

        // Deploy Basket ERC20s
        const ERC20Factory = await ethers.getContractFactory("ERC20Mock")
        const basketTokens = []
        for (const token of tokens) {
            const tokenDeployment = <ERC20Mock>await ERC20Factory.deploy(token.name, token.symbol)
            basketTokens.push({
                tokenAddress: tokenDeployment.address,
                genesisQuantity: token.quantityE18,
                rateLimit: 1,
                maxTrade: 1,
                priceInRToken: 0,
                slippageTolerance: 0,
            })
        }

        // Circuit Breaker Factory
        const CircuitBreakerFactory = await ethers.getContractFactory("CircuitBreaker")
        this.cb = <CircuitBreaker>await CircuitBreakerFactory.deploy(owner.address)

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
            circuitBreaker: this.cb.address,
            txFeeCalculator: ZERO_ADDRESS,
            insurancePool: ZERO_ADDRESS,
            protocolFund: ZERO_ADDRESS,
        }
        const RTokenFactory = await ethers.getContractFactory("RTokenMock", {
            libraries: {
                CompoundMath: math.address,
            },
        })
        const rToken = <RTokenMock>await RTokenFactory.connect(owner).deploy()
        await rToken.connect(owner).initialize("RToken", "RTKN", config, basketTokens, rsrInfo)
        this.rToken = new ERC20(rToken)

        await this.init(this.rToken.address)
    }

    basketERC20(token: Token): ERC20 {
        if (!this.basket.erc20s.has(token)) {
            throw new Error("Token not in basket")
        }
        return <ERC20>this.basket.erc20s.get(token)
    }

    issue(account: Address, amount: BigNumber): void {
        for (let token of this.basket.erc20s.keys()) {
            const amt = this.basket.getAdjustedQuantity(token).mul(amount).div(1e18)
            this.basket.erc20(token).transfer(account, this.rToken.address, amt)
        }
        this.rToken.mint(account, amount)
    }

    redeem(account: Address, amount: BigNumber): void {
        this.rToken.burn(account, amount)
        for (let token of this.basket.erc20s.keys()) {
            const amt = this.basket.getAdjustedQuantity(token).mul(amount).div(1e18)
            this.basket.erc20(token).transfer(this.rToken.address, account, amt)
        }
    }
}

class ERC20 extends Base implements AbstractERC20 {
    erc20: ERC20Mock

    constructor(erc20: ERC20Mock) {
        super()
        this.erc20 = erc20
    }

    async balanceOf(account: Address): Promise<BigNumber> {
        return await this.erc20.balanceOf(account)
    }
    async mint(account: Address, amount: BigNumber): Promise<void> {
        await this.erc20.mint(account, amount)
    }
    async burn(account: Address, amount: BigNumber): Promise<void> {

        await this.erc20.burn(account, amount)
    }
    async transfer(from: Address, to: Address, amount: BigNumber): Promise<void> {
        await this.erc20.transfer(from, to, amount)
    }
}
