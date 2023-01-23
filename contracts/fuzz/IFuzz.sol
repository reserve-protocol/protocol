// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/ITrade.sol";

import "contracts/interfaces/IRToken.sol";

// ================ Components ================
interface IRTokenFuzz is IRToken {
    /// The tokens and underlying quantities needed to issue `amount` qRTokens.
    /// @param amount {qRTok} quantity of qRTokens to quote.
    function quote(uint256 amount, RoundingMode)
        external
        view
        returns (address[] memory erc20s, uint256[] memory amounts);
}

// ================ Mocks ================
interface IMarketMock {
    // Execute an exchange where the caller sells `sellAmt` of `sell` to get `buyAmt` of `buy`.
    // Uses seeds for randomness when calculating the actualBuyAmount, which is returned
    function execute(
        IERC20 sell,
        IERC20 buy,
        uint256 sellAmt,
        uint256 buyAmt
    ) external returns (uint256);

    // Add/Remove seeds to be used for calculating buy amounts in trade settling
    function pushSeed(uint256 seed) external;

    function popSeed() external;
}

// ================ Main ================
interface IMainFuzz is IMain {
    // Fuzzing initializer. Each scenario's constructor should call this.
    function initFuzz(DeploymentParams memory params, IMarketMock marketMock_) external;

    // Retrieve the MarketMock contract, i.e, for trading
    function marketMock() external view returns (IMarketMock);

    // ==== Emulated sender ====
    function translateAddr(address addr) external view returns (address);

    // Begin sppofing; translateAddr(realAddr) will return `pretendAddr` instead of realAddr
    function spoof(address realAddr, address pretendAddr) external;

    // Unset spoofing for addr
    function unspoof(address realAddr) external;

    // ==== Token and User lightweight registries ====

    // register a new ERC20 token
    function addToken(IERC20 token) external;

    // number of registered tokens
    function numTokens() external view returns (uint256);

    // lookup an added token at index; error if index >= numTokens()
    function tokens(uint256 index) external view returns (IERC20);

    // return an arbitrary token: RSR, RToken, or a token from the registry
    function someToken(uint256 seed) external view returns (IERC20);

    // register a new user (address)
    function addUser(address user) external;

    // number of registered users
    function numUsers() external view returns (uint256);

    // number of constant addresses
    function numConstAddrs() external view returns (uint256);

    // lookup user at index; error if index >= numUsers()
    function users(uint256 index) external view returns (address);

    // return an arbitrary user
    function someUser(uint256 seed) external view returns (address);

    // return an arbitrary address: a contract, 0x0, 0x1, or a user from the registry
    function someAddr(uint256 seed) external view returns (address);

    // deployment timestamp
    function deployedAt() external view returns (uint48);
}
