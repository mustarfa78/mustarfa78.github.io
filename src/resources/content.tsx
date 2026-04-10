import { About, Blog, Gallery, Home, Newsletter, Person, Social, Work } from "@/types";
import { Line, Row, Text } from "@once-ui-system/core";

const person: Person = {
  firstName: "Mustafa",
  lastName: "Abdalruhman",
  name: `Mustafa Abdalruhman`,
  role: "Commerce & Statistics Student",
  avatar: "/images/avatar.jpg",
  email: "Mustarfa78@gmail.com",
  location: "Australia/Sydney", // Expecting the IANA time zone identifier, e.g., 'Europe/Vienna'
  languages: ["English", "Arabic"], // optional: Leave the array empty if you don't want to display languages
};

const newsletter: Newsletter = {
  display: false,
  title: <>Subscribe to {person.firstName}'s Newsletter</>,
  description: <>My weekly newsletter about creativity and engineering</>,
};

const social: Social = [
  // Links are automatically displayed.
  // Import new icons in /once-ui/icons.ts
  // Set essentials: true for links you want to show on the about page
  {
    name: "LinkedIn",
    icon: "linkedin",
    link: "https://www.linkedin.com/in/Abdalruhman",
    essential: true,
  },
  {
    name: "CV",
    icon: "document",
    link: "/Mustafa_Abdalruhman_CV.pdf",
    essential: true,
  },
  {
    name: "Call",
    icon: "phone",
    link: "tel:+61434039573",
    essential: true,
  },
  {
    name: "Email",
    icon: "email",
    link: `mailto:${person.email}`,
    essential: true,
  },
];

const home: Home = {
  path: "/",
  image: "/images/og/home.jpg",
  label: "Home",
  title: `${person.name}'s Portfolio`,
  description: `Portfolio website showcasing my work as a ${person.role}`,
  headline: <>A foothold into finance: my portfolio</>,
  featured: {
    display: true,
    title: (
      <Row gap="12" vertical="center">
        <strong className="ml-4">Trading Bot</strong>{" "}
        <Line background="brand-alpha-strong" vert height="20" />
        <Text marginRight="4" onBackground="brand-medium">
          Featured work
        </Text>
      </Row>
    ),
    href: "/work/binance-trading-bot",
  },
  subline: (
    <>
    I'm Mustafa, a student at <Text as="span" size="xl" weight="strong">UNSW</Text> pursuing Finance and Statistics (Bs Commerce/Science). I'm currently developing my skillset and knowledge in the financial space through project(s), which I wanted to showcase in this website.
</>
  ),
};

const about: About = {
  path: "/about",
  label: "About",
  title: `About - ${person.name}`,
  description: `Meet ${person.name}, ${person.role} from ${person.location}`,
  tableOfContent: {
    display: true,
    subItems: false,
  },
  avatar: {
    display: true,
  },
  calendar: {
    display: false,
    link: "",
  },
  intro: {
    display: true,
    title: "Introduction",
    description: (
      <>
        UNSW student pursuing Commerce & Science (Statistics) with a strong academic record and hands-on project experience. Currently a Student Partner at UNSW and part of Redback Racing's internal relations team. I've launched a confectionery business, worked in medical clinics, and built an algorithmic trading system from scratch in Python. Studying business and statistics to work towards a career in quantitative finance.
      </>
    ),
  },
  work: {
    display: true, // set to false to hide this section
    title: "Work Experience",
    experiences: [
      {
        company: "UNSW Redback Racing",
        timeframe: "Oct 2025 - Present",
        role: "Internal Relations",
        logo: "/images/logos/redback.svg",
        logoBackground: "#1a1a2e",
        achievements: [
          <>
            Part of the internal relations team for UNSW's Formula SAE racing team.
          </>,
          <>
            Coordinate communication between sub-teams and organise team events and logistics.
          </>,
        ],
        images: [],
      },
      {
        company: "UNSW",
        timeframe: "Oct 2025 - Present",
        role: "Student Ambassador",
        logo: "/images/logos/unsw_yellow.png",
        achievements: [
          <>
            Carried out engineering workshops for students as part of the Redback program.
          </>,
          <>
            Developed ideas into educational workshops and delivered them through presentations and collaboration.
          </>,
          <>
            Sydney, Australia
          </>,
        ],
        images: [],
      },
      {
        company: "UNSW",
        timeframe: "Jun 2025 - Aug 2025",
        role: "COMM1170 Student Partner",
        logo: "/images/logos/unsw_yellow.png",
        achievements: [
          <>
            Help facilitate tutorial sessions and support students in developing business communication skills.
          </>,
          <>
            Sydney, Australia
          </>,
        ],
        images: [],
      },
      {
        company: "Mas Medical Clinic",
        timeframe: "Jul 2024 - Jan 2025",
        role: "Physician Assistant",
        achievements: [
          <>
            Trained on IV injections, phlebotomy, and bandaging. Started as an unpaid intern and was hired as staff.
          </>,
          <>
            Baghdad, Iraq
          </>,
        ],
        images: [],
      },
      {
        company: "Al Jadirya Pharmacy",
        timeframe: "Jun 2024 - Sep 2024",
        role: "Pharmacy Intern",
        achievements: [
          <>
            Assisted pharmacists with dispensing, inventory management, and customer consultations.
          </>,
          <>
            Baghdad, Iraq
          </>,
        ],
        images: [],
      },
      {
        company: "Baghdadi Sweets",
        timeframe: "Oct 2022 - Feb 2023",
        role: "Co-founder",
        logo: "/images/logos/baghdadi.png",
        achievements: [
          <>
            Partnered with the school canteen to launch a confectionery business. Grew daily revenue from $0 to $60 in the first month.
          </>,
          <>
            Grew our <a href="https://www.instagram.com/baghdadi.sweets/" target="_blank" rel="noopener noreferrer" style={{color: 'var(--brand-on-background-strong)'}}>Instagram page</a> to market products and drive sales.
          </>,
          <>
            Baghdad, Iraq
          </>,
        ],
        images: [],
      },
      {
        company: "eBay",
        timeframe: "Apr 2020 - Jan 2025",
        role: "Freelance Seller",
        logo: "/images/logos/ebay.svg",
        achievements: [
          <>
            Generated over $3k in revenue selling gaming items as a side hobby.
          </>,
          <>
            250+ customers served with 50+ reviews and a 100% positive feedback rate.
          </>,
          <>
            Gold Coast, Australia
          </>,
        ],
        images: [],
      },
    ],
  },
  studies: {
    display: true, // set to false to hide this section
    title: "Studies",
    institutions: [
      {
        name: "UNSW",
        description: <>Commerce & Science, Business & Statistics (2025). Took COMP1511 (Programming Fundamentals) as an elective to learn coding.</>,
      },
      {
        name: "Brisbane School of Distance Education",
        description: <>Year 11-12 (2023-2024). ATAR: 92, scored 50/50 in the Mathematics final exam.</>,
      },
      {
        name: "Baghdad College",
        description: <>Year 11 (2022 - 2023).</>,
      },
      {
        name: "Benowa State High School",
        description: <>Year 7-10 (2019 - 2022), Gold Coast, Australia.</>,
      },
    ],
  },
  technical: {
    display: true,
    title: "Courses & Skills",
    skills: [
      {
        title: "Trading System Design and Engineering",
        description: (
          <>Understanding Python-based algorithmic trading system design through building my own proprietary model. Utilising agentic coding to implement my design and structure choices of the trading model.</>
        ),
        tags: [],
        images: [],
      },
      {
        title: "COMP1511 - Programming Fundamentals",
        description: (
          <>UNSW elective course covering C programming, algorithms, and data structures.</>
        ),
        tags: [],
        images: [],
      },
    ],
  },
};

const blog: Blog = {
  path: "/blog",
  label: "Blog",
  title: "Writing about design and tech...",
  description: `Read what ${person.name} has been up to recently`,
  // Create new blog posts by adding a new .mdx file to app/blog/posts
  // All posts will be listed on the /blog route
};

const work: Work = {
  path: "/work",
  label: "Work",
  title: `Projects - ${person.name}`,
  description: `Design and dev projects by ${person.name}`,
  // Create new project pages by adding a new .mdx file to app/blog/posts
  // All projects will be listed on the /home and /work routes
};

const gallery: Gallery = {
  path: "/gallery",
  label: "Gallery",
  title: `Photo gallery – ${person.name}`,
  description: `A photo collection by ${person.name}`,
  // Images by https://lorant.one
  // These are placeholder images, replace with your own
  images: [
    {
      src: "/images/gallery/horizontal-1.jpg",
      alt: "image",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/vertical-4.jpg",
      alt: "image",
      orientation: "vertical",
    },
    {
      src: "/images/gallery/horizontal-3.jpg",
      alt: "image",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/vertical-1.jpg",
      alt: "image",
      orientation: "vertical",
    },
    {
      src: "/images/gallery/vertical-2.jpg",
      alt: "image",
      orientation: "vertical",
    },
    {
      src: "/images/gallery/horizontal-2.jpg",
      alt: "image",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/horizontal-4.jpg",
      alt: "image",
      orientation: "horizontal",
    },
    {
      src: "/images/gallery/vertical-3.jpg",
      alt: "image",
      orientation: "vertical",
    },
  ],
};

export { person, social, newsletter, home, about, blog, work, gallery };
