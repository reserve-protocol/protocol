import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber } from "ethers"
import { ZERO, bn, pow10 } from "../../../common/numbers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { AbstractERC20, AbstractRToken, Address, Component, Simulation, Token } from "../interface"

export class Implementation0 implements Simulation {
    rToken: RToken

    constructor(owner: Address, rTokenName: string, rTokenSymbol: string, tokens: Token[]) {
        this.rToken = new RToken(owner, rTokenName, rTokenSymbol, tokens)
    }
}

class Base implements Component {
    // @ts-ignore
    _signer: Address
    _address: Address

    constructor(address: Address) {
        this._address = address
    }

    connect(sender: Address): this {
        this._signer = sender
        return this
    }

    address(): Address {
        return this._address
    }
}

class ERC20 extends Base implements AbstractERC20 {
    owner: Address
    name: string
    symbol: string
    balances: Map<Address, BigNumber> // address -> balance
    allowances: Map<Address, BigNumber> // address -> allowance

    constructor(owner: Address, name: string, symbol: string) {
        super(ethers.Wallet.createRandom().address)
        this.owner = owner
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
    tokens: Token[]
    erc20s: ERC20[]
    size: number

    constructor(tokens: Token[], erc20s: ERC20[]) {
        this.scalarE18 = pow10(18)
        this.tokens = tokens
        this.erc20s = erc20s
        this.size = this.erc20s.length
    }

    getAdjustedQuantity(index: number): BigNumber {
        return this.tokens[index].quantityE18.mul(this.scalarE18).div(pow10(18))
    }
}

class RToken extends ERC20 implements AbstractRToken {
    basket: Basket

    constructor(owner: Address, name: string, symbol: string, tokens: Token[]) {
        super(owner, name, symbol)
        const erc20s = tokens.map((t) => new ERC20(owner, t.name, t.symbol))
        this.basket = new Basket(tokens, erc20s)
    }

    basketERC20(index: number): ERC20 {
        return this.basket.erc20s[index]
    }

    async issue(amount: BigNumber): Promise<void> {
        for (let i = 0; i < this.basket.size; i++) {
            const amt = this.basket.getAdjustedQuantity(i).mul(amount).div(pow10(18))
            const basketERC20 = await this.basketERC20(i)
            await basketERC20.connect(this._signer).transfer(this.address(), amt)
        }
        this.mint(this._signer, amount)
    }

    async redeem(amount: BigNumber): Promise<void> {
        this.burn(this._signer, amount)
        for (let i = 0; i < this.basket.size; i++) {
            const amt = this.basket.getAdjustedQuantity(i).mul(amount).div(pow10(18))
            const basketERC20 = await this.basketERC20(i)
            await basketERC20.connect(this.address()).transfer(this._signer, amt)
        }
    }
}
