"""RMA travelers take their quantity from Units Received.

The customer may authorise an RMA for 10 units and ship 6. The shop reworks the
6 that arrived, so Units Received — not "Quantity RMA issued for" — is what the
traveler is built to. The issued figure is only a fallback for when nothing has
been received yet.
"""
import pytest
from types import SimpleNamespace

from routers.travelers import resolve_traveler_quantity, RMA_TRAVELER_TYPES


def posted(traveler_type="RMA_SAME", quantity=1, issued=None, received=None, shipped=None):
    return SimpleNamespace(
        traveler_type=traveler_type,
        quantity=quantity,
        quantity_rma_issued=issued,
        units_received=received,
        units_shipped=shipped,
    )


class TestRmaQuantitySource:
    def test_units_received_wins_over_issued(self):
        """The case this rule exists for: authorised 10, only 6 turned up."""
        assert resolve_traveler_quantity(posted(issued=10, received=6)) == 6

    def test_received_wins_even_when_higher_than_issued(self):
        assert resolve_traveler_quantity(posted(issued=5, received=6)) == 6

    def test_issued_is_used_when_nothing_received_yet(self):
        assert resolve_traveler_quantity(posted(issued=10, received=None)) == 10
        assert resolve_traveler_quantity(posted(issued=10, received=0)) == 10

    def test_falls_back_to_shipped_then_unit_rows(self):
        assert resolve_traveler_quantity(posted(shipped=75)) == 75
        assert resolve_traveler_quantity(posted(), rma_units=[1, 2, 3]) == 3

    @pytest.mark.parametrize("traveler_type", sorted(RMA_TRAVELER_TYPES))
    def test_applies_to_every_rma_type(self, traveler_type):
        assert resolve_traveler_quantity(
            posted(traveler_type=traveler_type, issued=10, received=6)) == 6

    def test_non_rma_travelers_keep_the_posted_quantity(self):
        """A standard traveler has a real Quantity field — never derive over it."""
        assert resolve_traveler_quantity(
            posted(traveler_type="ASSY", quantity=250, issued=10, received=6)) == 250

    def test_never_downgrades_a_stored_value(self):
        assert resolve_traveler_quantity(posted(quantity=1), current=19) == 19
