import hre from "hardhat";

async function main() {
  const EUSDRebalance__factory = await hre.ethers.getContractFactory("UpgradeUSDCCompWrappers")
  const signer = new hre.ethers.Wallet(
    process.env.PRIVATE_KEY_REBALANCER!,
  ).connect(hre.ethers.provider)
  const contract = EUSDRebalance__factory.connect(signer)
  const rebalancerContract = await contract.deploy()
  console.log("Rebalancer deployed at", rebalancerContract.address)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })