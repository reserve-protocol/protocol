// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/interfaces/IMain.sol";

import "contracts/interfaces/IRToken.sol";

// ================ Components ================
interface IRTokenFuzz is IRToken {
    // Issue some rtoken now, circumventing issuance delays.
    // To be called only from MarketMock.
    function fastIssue(uint256 amtRToken) external;

    /// The tokens and underlying quantities needed to issue `amount` qRTokens.
    /// @param amount {qRTok} quantity of qRTokens to quote.
    function quote(uint256 amount, RoundingMode)
        external
        view
        returns (address[] memory erc20s, uint256[] memory amounts);
}

// ================ Mocks ================
interface IMarketMock {
    // Execute an exchange where the caller sells `sellAmt` of `sell` and buys `buyAmt` of `buy`.
    function execute(
        IERC20 sell,
        IERC20 buy,
        uint256 sellAmt,
        uint256 buyAmt
    ) external;
}

// ================ Main ================
interface IMainFuzz is IMain {
    event TestError(string message);

    // Aspect: emulated sender
    function translateAddr(address addr) external view returns (address);

    // Begin sppofing; translateAddr(realAddr) will return `pretendAddr` instead of realAddr
    function spoof(address realAddr, address pretendAddr) external;

    // Unset spoofing for addr
    function unspoof(address realAddr) external;

    // A seed that other Fuzz mocks can base arbirary behaviors on
    function seed() external view returns (uint256);

    function setSeed(uint256 seed) external;

    // Retrive the MarketMock contract, i.e, for trading
    function marketMock() external view returns (IMarketMock);
}
