// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/mocks/ERC20Mock.sol";

import "contracts/fuzz/IFuzz.sol";

import "contracts/p0/Main.sol";

// ================ Main ================
// prettier-ignore
contract MainP0Fuzz is IMainFuzz, MainP0 {
    address public sender;
    uint256 public seed;
    IMarketMock public marketMock;

    address[] public USERS = [address(0x10000), address(0x20000), address(0x30000)];

    function setSender(address sender_) public { sender = sender_; }
    function setSeed(uint256 seed_) public { seed = seed_; }

    // Honestly, I imagine I don't really need this. Come back later anyhow...
    function setRToken(IRToken rToken_) external {
        emit RTokenSet(rToken, rToken_);
        rToken = rToken_;
    }

    function init(Components memory, IERC20, uint32)
        public virtual override(MainP0, IMain) initializer {
        __Auth_init(0);
        emit MainInitialized();
    }
}
