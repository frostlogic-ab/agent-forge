// biome-ignore lint/style/useImportType: <explanation>
import React from "react";
import styles from "./styles.module.css";

type FeatureItem = {
  title: string;
  Svg?: React.ComponentType<React.ComponentProps<"svg">>;
  description: React.ReactNode;
  tag?: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: "Decorator-Driven Architecture",
    Svg: require("@site/static/img/undraw_feature_yaml.svg").default,
    tag: "Modern TypeScript",
    description: (
      <>
        Build AI agents using modern TypeScript decorators. Simply annotate your
        classes with @agent, @tool, and @llmProvider decorators for powerful,
        declarative agent development with zero boilerplate.
      </>
    ),
  },
  {
    title: "Seamless LLM Integration",
    Svg: require("@site/static/img/undraw_feature_llm.svg").default,
    tag: "Provider Agnostic",
    description: (
      <>
        Connect with any LLM provider using the @llmProvider decorator. Supports
        OpenAI, Anthropic, Azure, and custom providers with automatic dependency
        injection and configuration management.
      </>
    ),
  },
  {
    title: "Rich Tool Ecosystem",
    Svg: require("@site/static/img/undraw_feature_tools.svg").default,
    tag: "Extend Capabilities",
    description: (
      <>
        Add capabilities to agents with @tool decorators and MCP integration.
        Access web search, file systems, databases, and custom APIs. Build
        tool-enabled agents with just a decorator!
      </>
    ),
  },
  {
    title: "Advanced Team Orchestration",
    Svg: require("@site/static/img/undraw_feature_orchestration.svg").default,
    tag: "Multi-Agent Systems",
    description: (
      <>
        Create sophisticated multi-agent systems with teams and workflows.
        Agents collaborate intelligently under manager coordination to solve
        complex, multi-step problems efficiently.
      </>
    ),
  },
  {
    title: "Distributed Agent Networks",
    Svg: require("@site/static/img/undraw_feature_a2a.svg").default,
    tag: "A2A Protocol",
    description: (
      <>
        Build distributed agent systems with @a2aClient and @a2aServer
        decorators. Enable agents to communicate across networks with built-in
        authentication, load balancing, and fault tolerance.
      </>
    ),
  },
  {
    title: "Knowledge Base Integration",
    Svg: require("@site/static/img/undraw_feature_mcp.svg").default,
    tag: "RAG Powered",
    description: (
      <>
        Add retrieval-augmented generation with @RAGChromaDb decorators. Agents
        automatically access document collections, embeddings, and knowledge
        bases for informed, context-aware responses.
      </>
    ),
  },
  {
    title: "Built-in Monitoring & Analytics",
    Svg: require("@site/static/img/undraw_feature_streaming.svg").default,
    tag: "Operational Excellence",
    description: (
      <>
        Monitor agent performance with @Visualizer and @RateLimiter decorators.
        Get real-time insights, cost tracking, performance metrics, and
        interactive timeline visualizations out of the box.
      </>
    ),
  },
  {
    title: "Plugin Architecture",
    Svg: require("@site/static/img/undraw_feature_logging.svg").default,
    tag: "Extensible Framework",
    description: (
      <>
        Extend the framework with @plugin decorators for logging, security,
        caching, and custom functionality. Create reusable cross-cutting
        concerns that work across all agents automatically.
      </>
    ),
  },
];

function Feature({ title, Svg, description, tag }: FeatureItem) {
  return (
    <div className={styles.featureItemContainer}>
      <div className={styles.featureContentWrapper}>
        {Svg && (
          <div className={styles.featureSvgPane}>
            <Svg className={styles.featureSvg} role="img" />
          </div>
        )}
        <div className={styles.featureTextPane}>
          {tag && <span className={styles.featureTag}>{tag}</span>}
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      {FeatureList.map((props) => (
        <Feature key={props.title} {...props} />
      ))}
    </section>
  );
}
