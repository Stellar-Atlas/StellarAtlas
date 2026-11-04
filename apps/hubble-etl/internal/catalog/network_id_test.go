package catalog

import (
	"encoding/hex"
	"testing"

	"github.com/stellar/go-stellar-sdk/network"
)

func TestCatalogNetworkIDCompatibility(t *testing.T) {
	for _, tc := range []struct{ name, passphrase, want string }{
		{"public", network.PublicNetworkPassphrase, "7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979"},
		{"testnet", network.TestNetworkPassphrase, "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472"},
		{"custom", "atlas-synthetic-network", "0f5c6575145ecf4ceb2965829e33a689ae8e32f17573f3b6623f6fd678de7f6f"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			id := network.ID(tc.passphrase)
			if got := hex.EncodeToString(id[:]); got != tc.want {
				t.Fatalf("network partition ID = %s, want %s", got, tc.want)
			}
		})
	}
}
