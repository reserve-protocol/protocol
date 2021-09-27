import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { ZERO, bn, pow10 } from "../../../common/numbers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { AbstractERC20, AbstractRToken, Address, Component, Simulation, Token } from "../interface"

class Base implements Component {
    // @ts-ignore
    _signer: Address
    address: Address

    constructor(address: Address) {
        this.address = address
    }

    connect(sender: Address): this {
        this._signer = sender
        return this
    }
}

export class Implementation0 implements Simulation {
    owner: Address
    rToken: RToken

    constructor(owner: Address, rTokenName: string, rTokenSymbol: string, tokens: Token[]) {
        this.owner = owner
        this.rToken = new RToken(rTokenName, rTokenSymbol, tokens)
    }
}

class ERC20 extends Base implements AbstractERC20 {
    name: string
    symbol: string
    balances: Map<Address, BigNumber> // address -> balance
    allowances: Map<Address, BigNumber> // address -> allowance

    constructor(name: string, symbol: string) {
        super(ethers.Wallet.createRandom().address)
        this.name = name
        this.symbol = symbol
        this.balances = new Map<Address, BigNumber>()
        this.allowances = new Map<Address, BigNumber>()
    }

    async balanceOf(account: Address): Promise<BigNumber> {
        return this.balances.get(account) || ZERO
    }

    async mint(account: Address, amount: BigNumber): Promise<void> {
        const bal = await this.balanceOf(account)
        this.balances.set(account, bal.add(amount))
    }

    async burn(account: Address, amount: BigNumber): Promise<void> {
        const bal = await this.balanceOf(account)
        if (bal.sub(amount).lt(ZERO)) {
            throw new Error("Cannot burn more than available balance")
        }
        this.balances.set(account, bal.sub(amount))
    }

    async transfer(to: Address, amount: BigNumber): Promise<void> {
        const fromBal = await this.balanceOf(this._signer)
        const toBal = await this.balanceOf(to)
        if (fromBal.lt(amount)) {
            throw new Error("Cannot transfer more than available balance")
        }
        this.balances.set(this._signer, fromBal.sub(amount))
        this.balances.set(to, toBal.add(amount))
    }
}

class Basket {
    scalarE18: BigNumber // a float multiplier expressed relative to 1e18
    erc20s: Map<Token, ERC20>

    constructor(erc20s: Map<Token, ERC20>) {
        this.scalarE18 = pow10(18)
        this.erc20s = erc20s
    }

    getAdjustedQuantity(token: Token): BigNumber {
        return token.quantityE18.mul(this.scalarE18).div(pow10(18))
    }
}

class RToken extends ERC20 implements AbstractRToken {
    basket: Basket

    constructor(name: string, symbol: string, tokens: Token[]) {
        super(name, symbol)
        const tokenMap = new Map<Token, ERC20>()
        for (let token of tokens) {
            tokenMap.set(token, new ERC20(token.name, token.symbol))
        }
        this.basket = new Basket(tokenMap)
    }

    basketERC20(token: Token): ERC20 {
        if (!this.basket.erc20s.has(token)) {
            throw new Error("Token not in basket")
        }
        return <ERC20>this.basket.erc20s.get(token)
    }

    async issue(amount: BigNumber): Promise<void> {
        for (let token of this.basket.erc20s.keys()) {
            const amt = this.basket.getAdjustedQuantity(token).mul(amount).div(pow10(18))
            this.basketERC20(token).connect(this._signer).transfer(this.address, amt)
        }
        this.mint(this._signer, amount)
    }

    async redeem(amount: BigNumber): Promise<void> {
        this.burn(this._signer, amount)
        for (let token of this.basket.erc20s.keys()) {
            const amt = this.basket.getAdjustedQuantity(token).mul(amount).div(pow10(18))
            this.basketERC20(token).connect(this.address).transfer(this._signer, amt)
        }
    }
}
