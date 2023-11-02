import hre from "hardhat";

async function main() {
  const EUSDRebalance__factory = await hre.ethers.getContractFactory("EUSDRebalance")
  const USDC = await hre.ethers.getContractAt("ERC20Mock", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
  const USDT = await hre.ethers.getContractAt("ERC20Mock", "0xdac17f958d2ee523a2206206994597c13d831ec7")

  const signer = new hre.ethers.Wallet(
    process.env.PRIVATE_KEY_REBALANCER!,
  ).connect(hre.ethers.provider)
  const contract = EUSDRebalance__factory.connect(signer)
  const rebalancerContract = await contract.deploy()
  console.log("Rebalancer deployed at", rebalancerContract.address)
  await USDC.approve(rebalancerContract.address, hre.ethers.constants.MaxUint256)
  await USDT.approve(rebalancerContract.address, hre.ethers.constants.MaxUint256)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })