// SPDX-License-Identifier: GPL-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ===================================================================
// ZapBaseV2_1 is the base contract for all ZapIn and ZapOut contracts
// It contains the logic for goodwill and affiliate fees, as well as
// the logic for emergency pausing the contract.
// ===================================================================
// solhint-disable-next-line contract-name-camelcase
abstract contract ZapBaseV2_1 is Ownable {
    using SafeERC20 for IERC20;
    bool public stopped = false;

    // if true, goodwill is not deducted
    mapping(address => bool) public feeWhitelist;

    uint256 public goodwill;
    // % share of goodwill (0-100 %)
    uint256 public affiliateSplit;
    // restrict affiliates
    mapping(address => bool) public affiliates;
    // affiliate => token => amount
    mapping(address => mapping(address => uint256)) public affiliateBalance;
    // token => amount
    mapping(address => uint256) public totalAffiliateBalance;
    // swapTarget => approval status
    mapping(address => bool) public approvedTargets;

    // solhint-disable-next-line const-name-snakecase
    address internal constant ETHAddress = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    // solhint-disable-next-line const-name-snakecase
    address internal constant ZapperAdmin = 0x3CE37278de6388532C3949ce4e886F365B14fB56;

    constructor(uint256 _goodwill, uint256 _affiliateSplit) {
        goodwill = _goodwill;
        affiliateSplit = _affiliateSplit;
    }

    // circuit breaker modifiers
    modifier stopInEmergency() {
        if (stopped) {
            revert("Paused");
        } else {
            _;
        }
    }

    function _getBalance(address token) internal view returns (uint256 balance) {
        if (token == address(0)) {
            balance = address(this).balance;
        } else {
            balance = IERC20(token).balanceOf(address(this));
        }
    }

    function _approveToken(address token, address spender) internal {
        IERC20 _token = IERC20(token);
        if (_token.allowance(address(this), spender) == 0) {
            _token.safeApprove(spender, type(uint256).max);
        }
    }

    function _approveToken(
        address token,
        address spender,
        uint256 amount
    ) internal {
        IERC20(token).safeApprove(spender, 0);
        IERC20(token).safeApprove(spender, amount);
    }

    // - to Pause the contract
    function toggleContractActive() public onlyOwner {
        stopped = !stopped;
    }

    // solhint-disable-next-line func-name-mixedcase
    function set_fee_whitelist(address zapAddress, bool status) external onlyOwner {
        feeWhitelist[zapAddress] = status;
    }

    // solhint-disable-next-line func-name-mixedcase
    function set_new_goodwill(uint256 _newGoodwill) public onlyOwner {
        require(_newGoodwill >= 0 && _newGoodwill <= 100, "GoodWill Value not allowed");
        goodwill = _newGoodwill;
    }

    // solhint-disable-next-line func-name-mixedcase
    function set_new_affiliate_split(uint256 _newAffiliateSplit) external onlyOwner {
        require(_newAffiliateSplit <= 100, "Affiliate Split Value not allowed");
        affiliateSplit = _newAffiliateSplit;
    }

    // solhint-disable-next-line func-name-mixedcase
    function set_affiliate(address _affiliate, bool _status) external onlyOwner {
        affiliates[_affiliate] = _status;
    }

    ///@notice Withdraw goodwill share, retaining affilliate share
    function withdrawTokens(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 qty;

            if (tokens[i] == ETHAddress) {
                qty = address(this).balance - totalAffiliateBalance[tokens[i]];

                Address.sendValue(payable(owner()), qty);
            } else {
                qty = IERC20(tokens[i]).balanceOf(address(this)) - totalAffiliateBalance[tokens[i]];
                IERC20(tokens[i]).safeTransfer(owner(), qty);
            }
        }
    }

    ///@notice Withdraw affilliate share, retaining goodwill share
    function affilliateWithdraw(address[] calldata tokens) external {
        uint256 tokenBal;
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenBal = affiliateBalance[msg.sender][tokens[i]];
            affiliateBalance[msg.sender][tokens[i]] = 0;
            totalAffiliateBalance[tokens[i]] = totalAffiliateBalance[tokens[i]] - tokenBal;

            if (tokens[i] == ETHAddress) {
                Address.sendValue(payable(msg.sender), tokenBal);
            } else {
                IERC20(tokens[i]).safeTransfer(msg.sender, tokenBal);
            }
        }
    }

    function setApprovedTargets(address[] calldata targets, bool[] calldata isApproved)
        external
        onlyOwner
    {
        require(targets.length == isApproved.length, "Invalid Input length");

        for (uint256 i = 0; i < targets.length; i++) {
            approvedTargets[targets[i]] = isApproved[i];
        }
    }

    function _subtractGoodwill(
        address token,
        uint256 amount,
        address affiliate,
        bool enableGoodwill
    ) internal returns (uint256 totalGoodwillPortion) {
        bool whitelisted = feeWhitelist[msg.sender];
        if (enableGoodwill && !whitelisted && goodwill > 0) {
            totalGoodwillPortion = (amount * goodwill) / 10000;

            if (affiliates[affiliate]) {
                if (token == address(0)) {
                    token = ETHAddress;
                }

                uint256 affiliatePortion = (totalGoodwillPortion * affiliateSplit) / 100;
                affiliateBalance[affiliate][token] += affiliatePortion;
                totalAffiliateBalance[token] += affiliatePortion;
            }
        }
    }

    receive() external payable {
        // solhint-disable-next-line avoid-tx-origin
        require(msg.sender != tx.origin, "Do not send ETH directly");
    }
}
