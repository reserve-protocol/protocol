// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.17;

contract CometMock {
    int256 internal _reserves;
    uint256 internal _targetReserves;
    address public externalDelegate;

    struct TotalsBasic {
        // 1st slot
        uint64 baseSupplyIndex;
        uint64 baseBorrowIndex;
        uint64 trackingSupplyIndex;
        uint64 trackingBorrowIndex;
        // 2nd slot
        uint104 totalSupplyBase;
        uint104 totalBorrowBase;
        uint40 lastAccrualTime;
        uint8 pauseFlags;
    }

    struct UserBasic {
        int104 principal;
        uint64 baseTrackingIndex;
        uint64 baseTrackingAccrued;
        uint16 assetsIn;
        uint8 _reserved;
    }

    constructor(uint256 targetReserves_, int256 reserves_, address delegate) {
        _targetReserves = targetReserves_;
        _reserves = reserves_;
        externalDelegate = delegate;
    }

    function setReserves(int256 amount) external {
        _reserves = amount;
    }

    function setTargetReserves(uint256 amount) external {
        _targetReserves = amount;
    }

    function targetReserves() external view returns (uint256) {
        return _targetReserves;
    }

    function getReserves() public view returns (int256) {
        return _reserves;
    }

    function accrueAccount(address account) public {}

    fallback() external payable {
        address delegate = externalDelegate;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := call(gas(), delegate, 0, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
