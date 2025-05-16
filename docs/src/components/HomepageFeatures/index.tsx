import clsx from "clsx";
import type React from "react";
import styles from "./styles.module.css";

type FeatureItem = {
  title: string;
  Svg?: React.ComponentType<React.ComponentProps<"svg">>;
  description: React.ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: "YAML-Defined Agents",
    Svg: require("@site/static/img/undraw_feature_yaml.svg").default,
    description: (
      <>
        Effortlessly define and configure your AI agents using simple,
        human-readable YAML files. Focus on agent logic, not boilerplate code,
        and get started quickly with a familiar format.
      </>
    ),
  },
  {
    title: "Flexible LLM Integration",
    Svg: require("@site/static/img/undraw_feature_llm.svg").default,
    description: (
      <>
        Seamlessly connect with a variety of Large Language Model providers.
        Agent Forge offers a unified interface, making it easy to switch or
        experiment with different models and capabilities.
      </>
    ),
  },
  {
    title: "Powerful Tool Ecosystem",
    Svg: require("@site/static/img/undraw_feature_tools.svg").default,
    description: (
      <>
        Extend your agents' capabilities with custom tools or leverage a growing
        library of pre-built tools. Enable agents to interact with external
        APIs, data sources, and other services.
      </>
    ),
  },
  {
    title: "Advanced Orchestration",
    Svg: require("@site/static/img/undraw_feature_orchestration.svg").default,
    description: (
      <>
        Build sophisticated multi-agent systems. Define sequential workflows for
        step-by-step task processing or create collaborative teams where agents
        work together under a manager to tackle complex problems.
      </>
    ),
  },
  {
    title: "Model Context Protocol (MCP)",
    Svg: require("@site/static/img/undraw_feature_mcp.svg").default,
    description: (
      <>
        Standardize agent-to-model communication with the Model Context
        Protocol, ensuring efficient and structured context management for
        optimal LLM performance and clarity.
      </>
    ),
  },
  {
    title: "Streaming Support",
    Svg: require("@site/static/img/undraw_feature_streaming.svg").default,
    description: (
      <>
        Enable real-time streaming of LLM responses and agent interactions for a
        more dynamic and responsive user experience. Monitor progress and get
        results as they happen.
      </>
    ),
  },
  {
    title: "Agent-to-Agent (A2A) Communication",
    Svg: require("@site/static/img/undraw_feature_a2a.svg").default,
    description: (
      <>
        Enable seamless communication between different AI agents, locally or
        across networks, using a robust JSON-RPC and Server-Sent Events (SSE)
        protocol for real-time updates.
      </>
    ),
  },
  {
    title: "Powerful Logging",
    Svg: require("@site/static/img/undraw_feature_logging.svg").default,
    description: (
      <>
        Gain deep insights into agent behavior with comprehensive logging.
        Easily debug and trace execution paths for individual agents and complex
        team workflows.
      </>
    ),
  },
];

function Feature({ title, Svg, description }: FeatureItem): React.ReactElement {
  return (
    <div className={styles.featureItemContainer}>
      <div className="container">
        <div className={styles.featureContentWrapper}>
          {Svg && (
            <div className={styles.featureSvgPane}>
              <Svg className={styles.featureSvg} role="img" />
            </div>
          )}
          <div className={styles.featureTextPane}>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): React.ReactElement {
  return (
    <section className={styles.features}>
      {FeatureList.map((props) => (
        <Feature key={props.title} {...props} />
      ))}
    </section>
  );
}
