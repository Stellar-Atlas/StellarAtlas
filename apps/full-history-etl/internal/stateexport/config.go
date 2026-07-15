package stateexport

import (
	"flag"
	"fmt"
	"io"
	"strings"
)

type Config struct {
	Dataset   Dataset
	InputPath string
}

func ParseConfig(args []string, stderr io.Writer) (Config, error) {
	flags := flag.NewFlagSet("full-history-state-export", flag.ContinueOnError)
	if stderr == nil {
		stderr = io.Discard
	}
	flags.SetOutput(stderr)
	var inputPath, datasetName string
	flags.StringVar(&inputPath, "input", "", "published state-change Parquet file")
	flags.StringVar(&datasetName, "dataset", "", "account-state-changes, ledgers, or trustline-state-changes")
	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}
	if flags.NArg() != 0 {
		return Config{}, fmt.Errorf("unexpected positional arguments: %s", strings.Join(flags.Args(), " "))
	}
	dataset, err := ParseDataset(datasetName)
	if err != nil {
		return Config{}, err
	}
	config := Config{Dataset: dataset, InputPath: inputPath}
	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func (c Config) Validate() error {
	if err := c.Dataset.Validate(); err != nil {
		return err
	}
	if c.InputPath == "" {
		return fmt.Errorf("input path is required")
	}
	return nil
}
