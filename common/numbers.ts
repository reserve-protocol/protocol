import { BigNumber } from "ethers"
import { ethers } from "hardhat"
import { BN_SCALE_FACTOR, SCALE_DECIMALS } from "./constants"

export const ZERO = BigNumber.from(0)

export const bn = (x: BigNumber | number): BigNumber => {
    if (BigNumber.isBigNumber(x)) return x
    const stringified = parseScientific(x.toString())
    const integer = stringified.split(".")[0]
    return BigNumber.from(integer)
}

export const pow10 = (exponent: number): BigNumber => {
    return bn(10).pow(exponent)
}

export const fp = (x: BigNumber | number): BigNumber => {
    if (BigNumber.isBigNumber(x)) {
        return BN_SCALE_FACTOR.mul(x)
    }
    return ethers.utils.parseUnits(x.toString(), SCALE_DECIMALS)
}

export const divCeil = (x: BigNumber, y: BigNumber): BigNumber =>
    // ceil(x/y) == (x + y - 1) / y
    x.add(y).sub(1).div(y)

function parseScientific(num: string) {
    // If the number is not in scientific notation return it as it is
    if (!/\d+\.?\d*e[+-]*\d+/i.test(num)) return num

    // Remove the sign
    const numberSign = Math.sign(Number(num))
    num = Math.abs(Number(num)).toString()

    // Parse into coefficient and exponent
    const [coefficient, exponent] = num.toLowerCase().split("e")
    let zeros = Math.abs(Number(exponent))
    const exponentSign = Math.sign(Number(exponent))
    const [integer, decimals] = (coefficient.indexOf(".") != -1 ? coefficient : `${coefficient}.`).split(".")

    if (exponentSign === -1) {
        zeros -= integer.length
        num =
            zeros < 0
                ? integer.slice(0, zeros) + "." + integer.slice(zeros) + decimals
                : "0." + "0".repeat(zeros) + integer + decimals
    } else {
        if (decimals) zeros -= decimals.length
        num =
            zeros < 0
                ? integer + decimals.slice(0, zeros) + "." + decimals.slice(zeros)
                : integer + decimals + "0".repeat(zeros)
    }

    return numberSign < 0 ? "-" + num : num
}
