import { HashRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import { IncidentForm } from "./components";

const navigation = [{ name: "Incident Report", href: "/" }];

function classNames(...classes) {
  return classes.filter(Boolean).join(" ");
}

function Shell() {
  const location = useLocation();
  return (
    <div className="flex flex-col flex-1">
      <nav className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-6">
              <img
                className="h-12 w-auto"
                src="https://www.norloworld.com/static/mainimages/northern-logistics-logo.png"
                alt="Northern Logistics"
              />
              <div className="hidden sm:flex sm:space-x-8">
                {navigation.map((item) => {
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={classNames(
                        isActive
                          ? "border-indigo-500 text-gray-900 dark:text-gray-100"
                          : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
                        "inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium"
                      )}
                    >
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="py-4 flex flex-col flex-1">
        <header className="mb-4">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-gray-900 dark:text-gray-100">
              Incident Report
            </h1>
          </div>
        </header>
        <main className="flex flex-col flex-1">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 flex flex-col flex-1 w-full">
            <Routes>
              <Route path="/" element={<IncidentForm />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
