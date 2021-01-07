// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;
pragma abicoder v2;

import '../libraries/Oracle.sol';

contract OracleTest {
    using Oracle for Oracle.Observation[1024];

    uint256 public blockTimestamp;
    function setBlockTimestamp(uint256 _blockTimestamp) external {
        blockTimestamp = _blockTimestamp;
    }

    Oracle.Observation[1024] public oracle;
    function setOracle(Oracle.Observation[] calldata _oracle, uint16 offset) external {
        for (uint16 i; i < _oracle.length; i++) {
            oracle[i + offset] = _oracle[i];
        }
    }

    // somewhat fragile, copied from scry in the pair
    function scry(uint256 _blockTimestamp, uint16 index, int24 tickCurrent, uint128 liquidityCurrent)
        external
        view
        returns (int24 tick, uint128 liquidity)
    {
        require(_blockTimestamp <= blockTimestamp, 'BT'); // can't look into the future

        Oracle.Observation memory oldest = oracle[(index + 1) % Oracle.CARDINALITY];

        // first, ensure that the oldest known observation is initialized
        if (oldest.initialized == false) {
            oldest = oracle[0];
            require(oldest.initialized, 'UI');
        }

        uint32 target = uint32(_blockTimestamp);
        uint32 current = uint32(blockTimestamp);

        // then, ensure that the target is greater than the oldest observation (accounting for wrapping)
        require(oldest.blockTimestamp < target || (oldest.blockTimestamp > current && target <= current), 'OLD');

        Oracle.Observation memory newest = oracle[index];

        // we can short-circuit if the target is after the youngest observation and return the current values
        if (newest.blockTimestamp < target || (newest.blockTimestamp > current && target <= current))
            return (tickCurrent, liquidityCurrent);

        // we can also short-circuit for the specific case where the target is the block.timestamp, but an interaction
        // updated the oracle before the check, as this might be fairly common and is a worst-case for the binary search
        if (newest.blockTimestamp == target) {
            Oracle.Observation memory before = oracle[(index == 0 ? Oracle.CARDINALITY : index) - 1];
            uint32 delta = newest.blockTimestamp - before.blockTimestamp;
            return (
                int24((newest.tickCumulative - before.tickCumulative) / delta),
                uint128((newest.liquidityCumulative - before.liquidityCumulative) / delta)
            );
        }


        return oracle.scry(target, index, current);

    }
}
