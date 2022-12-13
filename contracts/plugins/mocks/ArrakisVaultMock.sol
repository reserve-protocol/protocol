// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract ArrakisVaultMock is ERC20Mock{
    using FixLib for uint192;

    uint112 private reserve0;  
    uint112 private reserve1; 
    uint256 public fee;

    address public token0;
    address public token1;
    // hard-coded for now
    address public pool = 0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8;

    constructor(
        string memory name,
        string memory symbol,
        address _token0,
        address _token1,
        uint256 _fee,
        uint112 _reserve0,
        uint112 _reserve1
    ) ERC20Mock(name, symbol) {

        require(_fee <= 10000, "invalid fee amount");
        fee = 10000 - _fee;

        token0 = _token0;
        token1 = _token1;

        reserve0 =  _reserve0;
        reserve1 =  _reserve1;
        _mint(msg.sender, 10000 ether); // mints a max supply of 10,000 wei tokens to deployer
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function getReserves() external view returns (uint112 , uint112 , uint32){
        return (reserve0, reserve1, 0); 
        // timestamp is not used by tests, so this just returns 0 in place of it
    }

    function getAmountOut(uint amountIn, address tokenIn) public view returns (uint) { 
        (uint112 reserveIn, uint112 reserveOut) = tokenIn == token0 ? 
          (reserve0, reserve1) : (reserve1, reserve0);
        require(amountIn > 0 && reserveIn > 0 && reserveOut > 0, "getAmountOut() reverted"); 
        // INSUFFICIENT_INPUT_AMOUNT, INSUFFICIENT_LIQUIDITY
        uint amountInWithFee = amountIn * fee;
        uint numerator = amountInWithFee * reserveOut;
        uint denominator = (reserveIn * 10000) + amountInWithFee;
        return numerator / denominator;
    }

    function swap(uint256 _amount, address _token) external returns (bool){
        if(_token == token0){
            reserve0 += uint112(_amount); 
            reserve1 -= uint112(getAmountOut(_amount, token0));
            return true;
        } else if(_token == token1){
            reserve1 += uint112(_amount); 
            reserve0 -= uint112(getAmountOut(_amount, token1));
            return true;
        }

      return false;
    }
    
    function manipulateReserves(uint112 _reserve0, uint112 _reserve1) external {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
    }

    function getUnderlyingBalances() external view returns(uint256, uint256){
        return(reserve0, reserve1);
    }
    function getPositionID() external view returns(bytes32){
        return 0xc6efea72ccab389ddcda551b50080c7fa5a4846c0aa84aadc02c4231a7615f31;
    }

    function manager() external view returns(address){
    }

    function GELATO() external view returns(address){
    }

    function executiveRebalance(
    int24 newLowerTick,
    int24 newUpperTick,
    uint160 swapThresholdPrice,
    uint256 swapAmountBPS,
    bool zeroForOne) external {}

   function rebalance(
        uint160 swapThresholdPrice,
        uint256 swapAmountBPS,
        bool zeroForOne,
        uint256 feeAmount,
        address paymentToken
    ) external {}
}