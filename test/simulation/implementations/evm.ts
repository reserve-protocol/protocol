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
import { AbstractERC20, Address, Basket, AbstractImplementation, Token } from "../interface"

// WORK IN PROGRESS

// Sample Values for Configuration
const stakingDepositDelay = 3600 // seconds
const stakingWithdrawalDelay = 4800 // seconds
const issuanceRate = bn(25000)
const maxSupply = bn(100000)
const minMintingSize = bn(50)
const spread = bn(10)
const rebalancingFreezeCost = bn(50000)

export class EVMImplementation implements AbstractImplementation {
    // @ts-ignore
    owner: SignerWithAddress // @ts-ignore
    rToken: ERC20 // @ts-ignore
    basket: SimpleBasket // @ts-ignore

    CircuitBreakerFactory: ContractFactory // @ts-ignore
    ERC20Factory: ContractFactory // @ts-ignore

    cb: CircuitBreaker // @ts-ignore
    rsrToken: RSR // @ts-ignore

    constructor() {}

    async create(owner: SignerWithAddress, rTokenName: string, rTokenSymbol: string, tokens: Token[]): Promise<void> {
        this.owner = owner
        this.CircuitBreakerFactory = await ethers.getContractFactory("CircuitBreaker")
        this.cb = <CircuitBreaker>await this.CircuitBreakerFactory.deploy(this.owner.address)

        this.ERC20Factory = await ethers.getContractFactory("ERC20Mock")
        this.bskToken = <ERC20Mock>await this.ERC20Factory.deploy("Basket Token", "BSK")

        // RToken Configuration and setup
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

        const basketTokens = [
            {
                tokenAddress: this.bskToken.address,
                genesisQuantity: bn(1e18),
                rateLimit: 1,
                maxTrade: 1,
                priceInRToken: 0,
                slippageTolerance: 0,
            },
        ]
        // RSR (Insurance token)
        const PrevRSR = await ethers.getContractFactory("ReserveRightsTokenMock")
        const NewRSR = await ethers.getContractFactory("RSR")
        const prevRSRToken = <ReserveRightsTokenMock>await PrevRSR.deploy("Reserve Rights", "RSR")
        await prevRSRToken.connect(owner).pause()
        this.rsrToken = <RSR>await NewRSR.connect(owner).deploy(prevRSRToken.address, ZERO_ADDRESS, ZERO_ADDRESS)
        // Set RSR token info
        const rsrTokenInfo = {
            tokenAddress: this.rsrToken.address,
            genesisQuantity: 0,
            rateLimit: 1,
            maxTrade: 1,
            priceInRToken: 0,
            slippageTolerance: 0,
        }

        // External math lib
        const CompoundMath = await ethers.getContractFactory("CompoundMath")
        const math = await CompoundMath.deploy()

        // Deploy RToken and InsurancePool implementations
        const RToken = await ethers.getContractFactory("RTokenMock", {
            libraries: {
                CompoundMath: math.address,
            },
        })
        // Deploy RToken
        this.rToken = <RTokenMock>await RToken.connect(owner).deploy()
        await this.rToken.connect(owner).initialize("RToken", "RTKN", config, basketTokens, rsrTokenInfo)
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

export class SimpleBasket implements Basket {
    scalarE18: BigNumber // a float multiplier expressed relative to 1e18
    erc20s: Map<Token, ERC20>

    constructor(erc20s: Map<Token, ERC20>) {
        this.scalarE18 = bn(1e18)
        this.erc20s = erc20s
    }

    getAdjustedQuantity(token: Token): BigNumber {
        return token.quantityE18.mul(this.scalarE18).div(bn(1e18))
    }

    erc20(token: Token): ERC20 {
        if (!this.erc20s.has(token)) {
            throw new Error("Token not in basket")
        }
        return <ERC20>this.erc20s.get(token)
    }
}

export class ERC20 implements AbstractERC20 {}
