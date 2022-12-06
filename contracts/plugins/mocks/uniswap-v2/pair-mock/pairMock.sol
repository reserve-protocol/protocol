// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../mock-uni-v2/interfaces/IUniswapV2MockPair.sol";

/**
 * @dev UniV2Pai mock for invalid states test
 */
contract InvalidPairMock is IUniswapV2MockPair {
    uint112 private reserve0; // uses single storage slot, accessible via getReserves
    uint112 private reserve1; // uses single storage slot, accessible via getReserves
    uint32 private blockTimestampLast; // uses single storage slot, accessible via getReserves
    uint256 public override totalSupply;

    address public override token0;
    address public override token1;

    constructor(address token0_, address token1_) {
        initialize(token0_, token1_);
        blockTimestampLast = uint32(block.timestamp % 2 ** 32);
    }

    // factory not required
    function initialize(address _token0, address _token1) public virtual override {
        //require(msg.sender == factory, "UniswapV2Mock: FORBIDDEN"); // sufficient check
        token0 = _token0;
        token1 = _token1;
        reserve0 = 100 * 10 ** 18;
        reserve1 = 100 * 10 ** 6;
        totalSupply = 100 * 10 ** 18;
    }

    /// @dev function to set invalid reserves and Lps tokens
    function setReserves(uint112 x, uint112 y, uint256 L) public {
        reserve0 = x;
        reserve1 = y;
        totalSupply = L;
        blockTimestampLast = uint32(block.timestamp % 2 ** 32);
    }

    function getReserves() public view virtual override returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function name() external pure override returns (string memory) {}

    function symbol() external pure override returns (string memory) {}

    function decimals() external pure override returns (uint8) {
        return 18;
    }

    function balanceOf(address owner) external view override returns (uint256) {}

    function allowance(address owner, address spender) external view override returns (uint256) {}

    function approve(address spender, uint256 value) external override returns (bool) {}

    function transfer(address to, uint256 value) external override returns (bool) {}

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external override returns (bool) {}

    function DOMAIN_SEPARATOR() external view override returns (bytes32) {}

    function PERMIT_TYPEHASH() external pure override returns (bytes32) {}

    function nonces(address owner) external view override returns (uint256) {}

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {}

    function MINIMUM_LIQUIDITY() external pure override returns (uint256) {}

    function factory() external view override returns (address) {}

    function price0CumulativeLast() external view override returns (uint256) {}

    function price1CumulativeLast() external view override returns (uint256) {}

    function kLast() external view override returns (uint256) {}

    function mint(address to) external override returns (uint256 liquidity) {}

    function burn(address to) external override returns (uint256 amount0, uint256 amount1) {}

    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata data
    ) external override {}

    function skim(address to) external override {}

    function sync() external override {}
}
