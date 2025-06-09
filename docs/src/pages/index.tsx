import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import HomepageFeatures from "@site/src/components/HomepageFeatures";
import Layout from "@theme/Layout";
import clsx from "clsx";
import React from "react";

import Svg from "@site/static/img/agent-forge.webp";
import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero", styles.heroBanner)}>
      <div className={styles.heroContainer}>
        <div className={styles.heroLeft}>
          <h1 className="hero__title">{siteConfig.title}</h1>
          <p className="hero__subtitle">{siteConfig.tagline}</p>

          <p className={styles.heroIntro}>
            Agent Forge is a modern TypeScript framework for building AI agent
            systems using a powerful decorator-based architecture. Define agents
            with simple decorators, integrate seamlessly with LLM providers, add
            capabilities with tool decorators, and orchestrate complex
            multi-agent workflows. Experience the future of declarative AI
            development!
          </p>

          <div className={styles.buttons}>
            <Link
              className="button button--secondary button--lg"
              to="/docs/learn/intro"
            >
              Get Started
            </Link>
          </div>
        </div>

        <div className={styles.heroRight}>
          <img
            className={styles.heroImage}
            src={Svg}
            alt="Agent Forge Architecture Diagram"
          />
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <Layout
      title="Build AI Agents with Modern TypeScript"
      description="Agent Forge is a decorator-driven TypeScript framework for creating, orchestrating, and deploying AI agents with seamless LLM integration."
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
