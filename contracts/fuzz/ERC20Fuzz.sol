// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/fuzz/IFuzz.sol";

// An ERC20Fuzz is an ERC20Mock that knows about main, performs the _msgSender override that our
// components also do, and can track a Fuzz-oriented reward policy.
contract ERC20Fuzz is ERC20Mock {
    IMainFuzz internal main;

    ERC20Fuzz public rewardToken;
    uint256 public rewardAmt;

    // solhint-disable-next-line no-empty-blocks
    constructor(
        string memory name,
        string memory symbol,
        IMainFuzz _main
    ) ERC20Mock(name, symbol) {
        main = _main;
    }

    function setRewardToken(ERC20Fuzz token) public {
        rewardToken = token;
    }

    function setRewardAmount(uint256 amount) public {
        rewardAmt = amount % 1e29;
    }

    function payRewards(address who) public {
        if (address(rewardToken) == address(0)) return;
        if (rewardAmt == 0) return;
        if (balanceOf(who) == 0) return;

        rewardToken.mint(who, rewardAmt);
        require(rewardToken.totalSupply() <= 1e29, "Exceeded reasonable max of reward tokens");
    }

    function _msgSender() internal view virtual override returns (address) {
        return main.translateAddr(msg.sender);
    }

    function claimRewards() external {
        payRewards(msg.sender);
    }
}
