// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.5.0;

/// @title Oracle
/// @notice Provides price and liquidity data useful for a wide variety of system designs
/// @dev Instances of stored oracle data, "observations", are collected in the oracle array
///     Every pair is initialized with an oracle array length of 1. Anyone can pay the ~20k gas to increase the 
///     length of the oracle array. The new slot will be added after the full length of observations is populated.
///     The most recent observation is available, independent of the length of the oracle array, by passing 0 to the scry function.
library Oracle {
    struct Observation {
        // the block timestamp of the observation
        uint32 blockTimestamp;
        // the tick accumulator, i.e. tick * time elapsed since the pair was first initialized
        int56 tickCumulative;
        // the liquidity accumulator, i.e. liquidity * time elapsed since the pair was first initialized
        uint160 liquidityCumulative;
        // whether or not the observation is initialized
        bool initialized;
    }

    /// @notice Writes over a previous observation in a subsequent observation, given the passage of time and current values.
    /// @dev blockTimestamp _must_ be at, or after, last.blockTimestamp (accounting for overflow)
    /// @param last The last populated element in the oracle array
    /// @param blockTimestamp The timestamp of the observation, expressed in UNIX, truncated to uint32
    /// @param liquidity The total pair liquidity at the time of the call
    /// @return Observation The newly populated observation
    function transform(
        Observation memory last,
        uint32 blockTimestamp,
        int24 tick,
        uint128 liquidity
    ) private pure returns (Observation memory) {
        uint32 delta = blockTimestamp - last.blockTimestamp;
        return
            Observation({
                blockTimestamp: blockTimestamp,
                tickCumulative: last.tickCumulative + int56(tick) * delta,
                liquidityCumulative: last.liquidityCumulative + uint160(liquidity) * delta,
                initialized: true
            });
    }

    /// @notice Initialize the oracle array by writing the first slot. Called once for the lifecycle of the observations array.
    /// @param self The stored oracle array
    /// @param time The time of the oracle initialization, expressed in UNIX, via block.timestamp truncated to uint32
    /// @return cardinality The number of populated elements in the oracle array
    /// @return target The length of the oracle array, independent of population
    function initialize(Observation[65535] storage self, uint32 time)
        internal
        returns (uint16 cardinality, uint16 target)
    {
        self[0] = Observation({blockTimestamp: time, tickCumulative: 0, liquidityCumulative: 0, initialized: true});
        return (1, 1);
    }

    /// @notice writes an oracle observation to the array, at most once per block
    ///     indices cycle, and must be kept track of in the parent contract
    /// @param self The stored oracle array
    /// @param index The location of a given observation within the oracle array
    /// @param blockTimestamp The timestamp of the observation, expressed in UNIX, truncated to uint32
    /// @param tick The active tick at the time of the observation
    /// @param liquidity The total pair liquidity at the time of the call
    /// @param cardinality The number of populated elements in the oracle array
    /// @param cardinalityTarget The new number of elements in the oracle array, the surplus of which, when compared to cardinality, will be added to the array
    /// @return indexNext The first new element to be populated in the oracle array
    /// @return cardinalityNext The new cardinality of the oracle array
    function write(
        Observation[65535] storage self,
        uint16 index,
        uint32 blockTimestamp,
        int24 tick,
        uint128 liquidity,
        uint16 cardinality,
        uint16 cardinalityTarget
    ) internal returns (uint16 indexNext, uint16 cardinalityNext) {
        Observation memory last = self[index];

        // early return if we've already written an observation this block
        if (last.blockTimestamp == blockTimestamp) return (index, cardinality);

        // if the conditions are right, we can bump the cardinality
        if (index == (cardinality - 1) && cardinalityTarget > cardinality) {
            cardinalityNext = cardinalityTarget;
        } else {
            cardinalityNext = cardinality;
        }

        indexNext = (index + 1) % cardinalityNext;
        self[indexNext] = transform(last, blockTimestamp, tick, liquidity);
    }

    /// @notice Grow the observations array. Observations array length is stored in cardinality and target. cardinality cannot be
    ///     changed unless the index is currently the last element of the array, to avoid reordering in all other cases.
    ///     the cardinality is either immediately changed if the above is true, or changed on the next write when the write
    ///     fills the last index lt current cardinality.
    /// @param self The stored oracle array
    /// @param index The location of a given observation within the oracle array
    /// @param cardinalityOld The number of populated elements in the oracle array before being lengthened
    /// @param targetOld The prior length of the oracle array, independent of population
    /// @param targetNew The new length of the oracle array, independent of population
    /// @return cardinality The number of populated elements in the oracle array
    /// @return target The new length of the oracle array, independent of population
    function grow(
        Observation[65535] storage self,
        uint16 index,
        uint16 cardinalityOld,
        uint16 targetOld,
        uint16 targetNew
    ) internal returns (uint16 cardinality, uint16 target) {
        // no op if old target is new target
        if (targetNew <= targetOld) return (cardinalityOld, targetOld);
        // store in each slot to prevent fresh SSTOREs in swaps
        // this data will not be used because the initialized boolean is still false
        for (uint16 i = targetOld; i < targetNew; i++) self[i].blockTimestamp = 1;
        // if the index is already at the last element of the array, immediately grow the cardinality
        cardinality = index == cardinalityOld - 1 ? targetNew : cardinalityOld;
        target = targetNew;
    }

    /// @notice fetches the observations before and atOrAfter a target, i.e. where this range is satisfied: (before, atOrAfter]
    /// @dev the answer must be contained in the array
    ///      note that even though we're not modifying self, it must be passed by ref to save gas
    /// @param self The stored oracle array
    /// @param target The number of elements to be added to the oracle array
    /// @param index The location of a given observation within the oracle array
    /// @param cardinality The number of populated elements in the oracle array
    /// @return before
    /// @return atOrAfter
    function binarySearch(
        Observation[65535] storage self,
        uint32 target,
        uint16 index,
        uint16 cardinality
    ) private view returns (Observation memory before, Observation memory atOrAfter) {
        uint16 l = (index + 1) % cardinality; // oldest observation
        uint16 r = index; // newest observation
        uint16 i;
        while (true) {
            i = ((r - l) % cardinality) / 2 + l;

            atOrAfter = self[i % cardinality];

            // we've landed on an uninitialized tick, keep searching higher (more recently)
            if (!atOrAfter.initialized) {
                l = i + 1;
                continue;
            }

            before = (i == 0 || i == cardinality) ? self[cardinality - 1] : self[(i % cardinality) - 1];

            // check if we've found the answer!
            if (
                (before.blockTimestamp <= target && target <= atOrAfter.blockTimestamp) ||
                (before.blockTimestamp > atOrAfter.blockTimestamp &&
                    (before.blockTimestamp <= target || target <= atOrAfter.blockTimestamp))
            ) break;

            // adjust for overflow
            uint256 targetAdjusted = target;
            uint256 atOrAfterAdjusted = atOrAfter.blockTimestamp;
            uint256 newestAdjusted = self[r % cardinality].blockTimestamp;
            if (targetAdjusted > newestAdjusted || atOrAfterAdjusted > newestAdjusted) {
                if (targetAdjusted <= newestAdjusted) targetAdjusted += 2**32;
                if (atOrAfterAdjusted <= newestAdjusted) atOrAfterAdjusted += 2**32;
            }

            if (atOrAfterAdjusted < targetAdjusted) l = i + 1;
            else r = i - 1;
        }
    }

    /// @notice Fetches the observations before and atOrAfter a given target
    /// @dev Used by scry() to contextualize a potential counterfactual observation as it would have occurred if a block were mined at the time of the desired observation
    /// @param self The stored oracle array
    /// @param time The time of the observation, expressed in UNIX, through block.timestamp truncated to uint32
    /// @param target The length of the oracle array, independent of population
    /// @param tick The active tick at the time of the returned or simulated observation
    /// @param index The location of a given observation within the oracle array
    /// @param liquidity The total pair liquidity at the time of the call
    /// @param cardinality The number of populated elements in the oracle array
    /// @return beforeOrAt The observation which occurred at, or before, the given timestamp
    /// @return atOrAfter The observation which occurred at, or after, the given timestamp
    function getSurroundingObservations(
        Observation[65535] storage self,
        uint32 time, 
        uint32 target,
        int24 tick,
        uint16 index,
        uint128 liquidity,
        uint16 cardinality
    ) private view returns (Observation memory beforeOrAt, Observation memory atOrAfter) {
        // first, set before to the oldest observation, and make sure it's initialized
        beforeOrAt = self[(index + 1) % cardinality];
        if (!beforeOrAt.initialized) {
            beforeOrAt = self[0];
            // cardinality should not be > 0 unless at least one observation is initialized
            assert(beforeOrAt.initialized);
        }

        // ensure that the target is greater than the oldest observation (accounting for block timestamp overflow)
        require(beforeOrAt.blockTimestamp <= target && (target <= time || beforeOrAt.blockTimestamp >= time), 'OLD');

        // now, optimistically set before to the newest observation
        beforeOrAt = self[index];

        // before proceeding, short-circuit if the target equals the newest observation, meaning we're in the same block
        // but an interaction updated the oracle before this tx, so before is actually atOrAfter
        if (target == beforeOrAt.blockTimestamp) return (beforeOrAt, atOrAfter);

        // adjust for overflow
        uint256 beforeAdjusted = beforeOrAt.blockTimestamp;
        uint256 targetAdjusted = target;
        if (beforeAdjusted > time && targetAdjusted <= time) targetAdjusted += 2**32;
        if (targetAdjusted > time) beforeAdjusted += 2**32;

        // once here, check if we're right and return a counterfactual observation for atOrAfter
        if (beforeAdjusted < targetAdjusted) return (beforeOrAt, transform(beforeOrAt, time, tick, liquidity));

        // we're wrong, so perform binary search
        return binarySearch(self, target, index, cardinality);
    }

    /// @notice Constructs a observation of a particular time, now or in the past.
    /// @dev Called from the pair contract. Contingent on having >=1 observations before the call. 0 may be passed as `secondsAgo' to return the present pair data
    ///      if called with a timestamp falling between two consecutive observations, returns a counterfactual observation as it would appear if a block were mined at the time of the call
    /// @param self The stored oracle array
    /// @param time The time of the desired observation, expressed in UNIX, through block.timestamp truncated to uint32
    /// @param secondsAgo The amount of reach back, in seconds, at which to return an observation
    /// @param tick The active tick at the time of the returned or simulated observation
    /// @param index The location of a given observation within the oracle array
    /// @param liquidity The total pair liquidity at the time of the call
    /// @return tickCumulative The tick * time elapsed since the pair was first initialized
    /// @return liquidityCumulative The liquidity * time elapsed since the pair was first initialized
    function scry(
        Observation[65535] storage self,
        uint32 time,
        uint32 secondsAgo,
        int24 tick,
        uint16 index,
        uint128 liquidity,
        uint16 cardinality
    ) internal view returns (int56 tickCumulative, uint160 liquidityCumulative) {
        require(cardinality > 0, 'I');
        if (secondsAgo == 0) {
            // because cardinality is 0, the last observation is necessarily initialized
            Observation memory last = self[index];
            if (last.blockTimestamp != time) last = transform(last, time, tick, liquidity);
            return (last.tickCumulative, last.liquidityCumulative);
        }

        uint32 target = time - secondsAgo;

        (Observation memory beforeOrAt, Observation memory atOrAfter) =
            getSurroundingObservations(self, time, target, tick, index, liquidity, cardinality);

        Oracle.Observation memory at;
        if (target == beforeOrAt.blockTimestamp) {
            // if we're at the left boundary, make it so
            at = beforeOrAt;
        } else if (target == atOrAfter.blockTimestamp) {
            // if we're at the right boundary, make it so
            at = atOrAfter;
        } else {
            // else, adjust counterfactually
            uint32 delta = atOrAfter.blockTimestamp - beforeOrAt.blockTimestamp;
            int24 tickDerived = int24((atOrAfter.tickCumulative - beforeOrAt.tickCumulative) / delta);
            uint128 liquidityDerived =
                uint128((atOrAfter.liquidityCumulative - beforeOrAt.liquidityCumulative) / delta);
            at = transform(beforeOrAt, target, tickDerived, liquidityDerived);
        }

        return (at.tickCumulative, at.liquidityCumulative);
    }
}
