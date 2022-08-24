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
    // Aspect: emulated sender
    function translateAddr(address addr) external view returns (address);

    // Begin sppofing; translateAddr(realAddr) will return `pretendAddr` instead of realAddr
    function spoof(address realAddr, address pretendAddr) external;

    // Unset spoofing for addr
    function unspoof(address realAddr) external;

    // Retrieve the MarketMock contract, i.e, for trading
    function marketMock() external view returns (IMarketMock);

    // Tokens and Users by IDs
    function numTokens() external view returns (uint256);

    function addToken(IERC20 token) external;

    // lookup an added token at index; error if index >= numTokens()
    function tokens(uint256 index) external view returns (IERC20);

    // return an arbitrary token: added, RSR, or RToken
    function someToken(uint256 seed) external view returns (IERC20);

    function numUsers() external view returns (uint256);

    function addUser(address user) external;

    // lookup user at index; error if index >= numUsers()
    function users(uint256 index) external view returns (address);

    // return an arbitrary address: a contract, an added user, 0x0, or 0x1
    function someAddr(uint256 seed) external view returns (address);
}
