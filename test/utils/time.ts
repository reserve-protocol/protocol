import { ethers } from "hardhat"

export const advanceTime = async (seconds: number | string) => {
    await ethers.provider.send("evm_increaseTime", [parseInt(seconds.toString())])
    await ethers.provider.send("evm_mine", [])
}
