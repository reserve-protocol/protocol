
const { BigNumber } = require("ethers");

// getChainId: Returns current chain Id
async function getChainId() {
  let _chainId;
  try {
    _chainId = await this.network.provider.send('eth_chainId');
  } catch (e) {
    console.log('failed to get chainId, falling back on net_version...');
    _chainId = await this.network.provider.send('net_version');
  }

  if (!_chainId) {
    throw new Error(`could not get chainId from network`);
  }
  if (_chainId.startsWith('0x')) {
    _chainId = BigNumber.from(_chainId).toString();
  }
  return _chainId;
}

module.exports = {
  getChainId
};
